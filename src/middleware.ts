import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ROLE_HOME, type Role } from "@/lib/auth/roles";

const PUBLIC_PATHS = ["/login", "/set-password"];
const SHARED_AUTHENTICATED_PREFIXES = ["/visits/"];

function isSharedAuthenticatedPath(path: string): boolean {
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

export async function middleware(req: NextRequest) {
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

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (!user) {
    if (PUBLIC_PATHS.includes(path)) return res;
    return redirectWithSession(req, res, "/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password, status")
    .eq("id", user.id)
    .single();

  if (!profile) return redirectWithSession(req, res, "/login");

  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return redirectWithSession(req, res, "/login");
  }

  if (profile.must_change_password && path !== "/set-password") {
    return redirectWithSession(req, res, "/set-password");
  }

  const home = ROLE_HOME[profile.role as Role];
  // Owner may visit any route; other roles are confined to their home subtree or shared paths.
  if (
    profile.role !== "owner"
    && !path.startsWith(home)
    && !PUBLIC_PATHS.includes(path)
    && !isSharedAuthenticatedPath(path)
  ) {
    return redirectWithSession(req, res, home);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)"],
};
