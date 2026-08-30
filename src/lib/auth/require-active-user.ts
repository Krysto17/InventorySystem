import { getProfile, type Profile } from "@/lib/auth/get-profile";

export type ActiveUserDenial = { reason: "unauthenticated" | "disabled" | "must_change_password" };

/**
 * The checks every entry point owes, in one place.
 *
 * The proxy already performs these for page navigations, but it deliberately
 * does not run on `/api` — route handlers must answer with JSON, not an HTML
 * redirect. So an API route that trusted the proxy inherited none of them: a
 * user who had never changed the temporary password handed to them over
 * WhatsApp could still pull business documents.
 *
 * Returns the profile, or the reason it refused. The caller decides the status
 * code, because a page and a route handler answer differently.
 */
export async function requireActiveUser(): Promise<
  { ok: true; profile: Profile } | { ok: false } & ActiveUserDenial
> {
  const profile = await getProfile();
  if (!profile) return { ok: false, reason: "unauthenticated" };
  if (profile.status !== "active") return { ok: false, reason: "disabled" };
  if (profile.must_change_password) return { ok: false, reason: "must_change_password" };
  return { ok: true, profile };
}
