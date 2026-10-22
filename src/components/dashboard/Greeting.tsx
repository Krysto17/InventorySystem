import { getProfile } from "@/lib/auth/get-profile";

/**
 * The time of day as it is AT THE SITE, not on the server.
 *
 * Vercel runs in UTC and the business runs in Nigeria (WAT, UTC+1), so reading
 * the server clock would greet everyone an hour out — "Good morning" at 11pm
 * local, and the wrong word either side of every boundary. The zone is fixed
 * rather than taken from the browser because all three sites are in one
 * country, and a fixed zone also keeps this a server component: a clock read on
 * the client would differ from the server's render and hydrate inconsistently.
 */
export const SITE_TIMEZONE = "Africa/Lagos";

/** Exported for the boundary tests; the buckets are the only real logic here. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * A greeting at the top of a role's own dashboard.
 *
 * Every role lands on a different screen (ROLE_HOME), so this sits in the
 * header each of those screens already has rather than in the shell — the shell
 * wraps every page, and a greeting repeated above a settlement or a stock count
 * would be noise. The user's name is otherwise only in the sidebar, which is
 * collapsed on a phone, and most of the staff here work from one.
 *
 * `getProfile()` is wrapped in React `cache()`, so asking for it again costs
 * nothing: the page that renders this has already fetched it for this request.
 */
/** The hour of day at the site, 0-23. */
export function siteHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SITE_TIMEZONE,
      hour: "numeric",
      hourCycle: "h23", // 00, not 24, at midnight
    }).format(at),
  );
}

export async function Greeting() {
  const me = await getProfile();
  if (!me) return null;

  const hour = siteHour(new Date());

  // First name only — "Good morning, Christopher" rather than the full name on
  // the staff list. Falls back to the username when no name was recorded.
  const firstName = (me.full_name ?? "").trim().split(/\s+/)[0] || me.username;

  return (
    // Same weight and ink as the role heading below it, a step down in size so
    // the screen still has one title rather than two.
    <p className="text-sm font-bold text-ink">
      {greetingFor(hour)}
      {firstName ? <>, {firstName}</> : ""}
    </p>
  );
}
