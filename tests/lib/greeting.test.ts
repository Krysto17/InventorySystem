import { describe, it, expect } from "vitest";
import { greetingFor, siteHour, SITE_TIMEZONE } from "@/components/dashboard/Greeting";

// The dashboards greet by time of day. Vercel runs in UTC and the sites run in
// Nigeria (UTC+1), so reading the server clock would greet an hour out — which
// is wrong for a full hour either side of every boundary, and plainly wrong
// late at night. These tests pin the zone and the bucket edges.
describe("dashboard greeting", () => {
  it("uses the site's timezone, not the server's", () => {
    expect(SITE_TIMEZONE).toBe("Africa/Lagos");
    // 23:30 UTC is already 00:30 the next day in Lagos.
    expect(siteHour(new Date("2026-10-22T23:30:00Z"))).toBe(0);
    // ...and 04:30 UTC is 05:30 Lagos, i.e. already morning.
    expect(siteHour(new Date("2026-10-22T04:30:00Z"))).toBe(5);
  });

  it("reports midnight as 0, never 24", () => {
    expect(siteHour(new Date("2026-10-22T23:00:00Z"))).toBe(0);
  });

  it("greets correctly at every bucket edge", () => {
    expect(greetingFor(4)).toBe("Good evening");   // still night
    expect(greetingFor(5)).toBe("Good morning");   // morning opens
    expect(greetingFor(11)).toBe("Good morning");  // last morning hour
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(16)).toBe("Good afternoon"); // last afternoon hour
    expect(greetingFor(17)).toBe("Good evening");
    expect(greetingFor(23)).toBe("Good evening");
    expect(greetingFor(0)).toBe("Good evening");   // night shift
  });

  it("covers all 24 hours with a greeting", () => {
    for (let h = 0; h < 24; h++) {
      expect(greetingFor(h), `hour ${h}`).toMatch(/^Good (morning|afternoon|evening)$/);
    }
  });
});
