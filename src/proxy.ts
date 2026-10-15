import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { JWK } from "@supabase/supabase-js";

// Role → landing route. Intentionally INLINED rather than imported from
// src/lib/auth/roles.ts: Vercel's Edge bundler won't pull a local module into
// the middleware bundle (it deploys as an "unsupported module"), even though
// `next build` resolves the import fine locally. Keep in sync with ROLE_HOME in
// src/lib/auth/roles.ts — tests/auth/roles.test.ts asserts they match.
const ROLE_HOME: Record<string, string> = {
  processing: "/processing",
  receiving: "/receiving",
  qc: "/qc",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  stock_keeper: "/stocked-materials",
  gate: "/gate",
  owner: "/owner",
};

const PUBLIC_PATHS = ["/login", "/set-password"];
// Paths any authenticated role may enter, beyond their own home subtree. The
// supplier directory (search + per-supplier detail) is shared by every role
// (#4), so it must not be confined to the owner's subtree.
const SHARED_AUTHENTICATED_PREFIXES = ["/visits/", "/suppliers", "/stocked-materials"];

// Extra subtrees a role may enter beyond its own home. The manager owns
// inventory (blueprint: no standalone inventory role), so it reaches /inventory.
const EXTRA_ROLE_PREFIXES: Record<string, string[]> = {
  // The manager owns inventory; the general (New-Site) manager also runs the
  // receiving module + the technical config (material types, machines,
  // employees). Those config pages gate themselves to the GM (requireConfigManager)
  // and RLS restricts the writes, so exposing the path to all managers is safe.
  manager: [
    "/inventory", "/receiving",
    "/owner/material-types", "/owner/machines", "/owner/employees",
  ],
};

// The store keeper's login is their store and nothing else — the shared
// supplier directory and visit records are not part of their job.
const NO_SHARED_PATHS_ROLES = ["stock_keeper"];

function isSharedAuthenticatedPath(path: string, role: string): boolean {
  if (NO_SHARED_PATHS_ROLES.includes(role)) return false;
  return SHARED_AUTHENTICATED_PREFIXES.some((p) => path.startsWith(p));
}

// Build a redirect response that preserves any cookies Supabase wrote to `res`
// during getUser()/getSession() (token refresh, signOut, etc.). Without this,
// refreshed cookies vanish on redirects and the user gets logged out.
function redirectWithSession(req: NextRequest, res: NextResponse, to: string): NextResponse {
  const redirected = NextResponse.redirect(new URL(to, req.url));
  for (const c of res.cookies.getAll()) {
    redirected.cookies.set(c.name, c.value);
  }
  return redirected;
}

// The published JWKS for this project, cached for the life of the server
// instance.
//
// `getClaims()` caches the key set on the CLIENT, but this proxy builds a fresh
// client per request, so that cache would never be warm and every request would
// fetch the JWKS instead — trading a GoTrue call for a JWKS call and saving
// only the auth queries. Holding it at module scope means a warm instance
// verifies tokens with no network at all. The key set is public, so there is
// nothing secret to keep here.
//
// `getClaims` is given this set and only falls back to fetching if the token's
// `kid` is absent from it, which is what makes a key rotation self-healing: the
// first token signed by a new key misses this cache, the library fetches, and
// the TTL brings this copy up to date.
const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { keys: JWK[] } | null = null;
let jwksCachedAt = 0;

async function cachedJwks(): Promise<{ keys: JWK[] } | undefined> {
  if (jwksCache && Date.now() - jwksCachedAt < JWKS_TTL_MS) return jwksCache;
  try {
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } },
    );
    if (!r.ok) return undefined;
    const body = (await r.json()) as { keys?: JWK[] };
    if (!body.keys?.length) return undefined;
    jwksCache = { keys: body.keys };
    jwksCachedAt = Date.now();
    return jwksCache;
  } catch {
    // Let the library fetch it itself rather than failing the request.
    return undefined;
  }
}

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    },
  );

  // Verify the session WITHOUT calling the Auth server.
  //
  // `getUser()` makes an HTTP round trip to GoTrue on every request, and GoTrue
  // answers it with five queries (users, sessions, mfa_amr_claims, mfa_factors,
  // identities). This proxy runs ~10,400 times a day — nine times more often
  // than a page actually renders, because every <Link> prefetch passes through
  // here too — so that was ~58,000 auth queries and ~10,400 Auth-server calls a
  // day, each one logged by the Auth service and the gateway. It was the single
  // largest driver of this project's log ingestion, which is over the plan
  // allowance (measured in pg_stat_statements over a 114-day window).
  //
  // This project signs its JWTs with an asymmetric ES256 key, so `getClaims()`
  // verifies the signature locally with WebCrypto against the published JWKS,
  // which it caches. No Auth-server call, no auth queries. It still refreshes
  // the session when the access token is near expiry, so `redirectWithSession`
  // keeps carrying the new cookies.
  //
  // What local verification does NOT see is a session revoked before its token
  // expires. That is covered immediately below: the `status` check on `profiles`
  // still runs on every request, so a deactivated account is signed out on its
  // next navigation exactly as before. Identity is also re-verified against the
  // Auth server once per rendered page by getProfile()'s `getUser()`.
  const path = req.nextUrl.pathname;

  // No Supabase cookie means no session to verify, so skip the auth work
  // entirely. This is the login screen and the PWA's own fetches, which used to
  // pay for a full getUser() round trip to be told what the absent cookie
  // already said.
  let userId: string | undefined;
  if (req.cookies.getAll().some((c) => c.name.startsWith("sb-"))) {
    const jwks = await cachedJwks();
    const { data: claims } = await supabase.auth.getClaims(undefined, jwks ? { jwks } : undefined);
    userId = claims?.claims?.sub;

    // Fail safe, not fail shut. If local verification cannot produce a subject
    // for any reason — a key rotation mid-flight, a JWKS that will not parse,
    // WebCrypto missing — ask the Auth server the old way before concluding the
    // caller is a stranger. Without this, one unexpected failure here would sign
    // out every user at once.
    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
    }
  }

  if (!userId) {
    if (PUBLIC_PATHS.includes(path)) return res;
    return redirectWithSession(req, res, "/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password, status")
    .eq("id", userId)
    .single();

  if (!profile) return redirectWithSession(req, res, "/login");

  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return redirectWithSession(req, res, "/login");
  }

  if (profile.must_change_password && path !== "/set-password") {
    return redirectWithSession(req, res, "/set-password");
  }

  const home = ROLE_HOME[profile.role as string] ?? "/login";
  const extraPrefixes = EXTRA_ROLE_PREFIXES[profile.role] ?? [];
  // Owner may visit any route; other roles are confined to their home subtree,
  // shared paths, or any extra subtree granted to their role.
  if (
    profile.role !== "owner"
    && !path.startsWith(home)
    && !PUBLIC_PATHS.includes(path)
    && !isSharedAuthenticatedPath(path, profile.role)
    && !extraPrefixes.some((p) => path.startsWith(p))
  ) {
    return redirectWithSession(req, res, home);
  }
  return res;
}

// NB: the Next 16 `proxy` convention ALWAYS runs on the Node.js runtime, which
// is required here — @supabase/ssr pulls in Node-only code (ws via realtime-js,
// which references __dirname) that crashes Edge with "__dirname is not defined".
// (No `export const runtime` — route segment config isn't allowed in proxy.)
export const config = {
  // Exclude /api — route handlers (e.g. /api/pdf) authenticate themselves and
  // must return JSON 401/403, not an HTML redirect to /login.
  //
  // Also exclude the two PWA files. The browser fetches them from the LOGIN
  // screen, before a session exists, so redirecting them to /login returned
  // HTML where a script and a manifest were expected and the app could not be
  // installed. Neither file contains anything private.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)"],
};
