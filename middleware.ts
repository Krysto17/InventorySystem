import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ROLE_HOME, type Role } from "@/lib/auth/roles";

const PUBLIC_PATHS = ["/login", "/set-password"];

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
    if (PUBLIC_PATHS.some((p) => path.startsWith(p))) return res;
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.redirect(new URL("/login", req.url));

  if (profile.must_change_password && path !== "/set-password") {
    return NextResponse.redirect(new URL("/set-password", req.url));
  }

  const home = ROLE_HOME[profile.role as Role];
  // Owner may visit any route; other roles are confined to their own home subtree.
  if (profile.role !== "owner" && !path.startsWith(home) && !PUBLIC_PATHS.includes(path)) {
    return NextResponse.redirect(new URL(home, req.url));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg)).*)"],
};
