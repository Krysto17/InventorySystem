import { describe, it, expect } from "vitest";
import { APP_BASE, requireAppServer } from "../setup/app-server";

/**
 * HTTP-level regression cover for Phase 1's H-01 and M-01.
 *
 * Needs the app running at NEXT_PUBLIC_SITE_URL. If nothing is listening these
 * skip and say so; if something else is listening the harness throws rather
 * than reporting results from the wrong service.
 */
const REQUIRED_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

// Probed at collection time so an absent app reports as SKIPPED rather than as
// a row of passes that never ran. A wrong app still throws from the probe.
const appIsUp = await requireAppServer();
const itHttp = appIsUp ? it : it.skip;

describe("security headers and PWA reachability", () => {

  itHttp("every required header is on a normal page", async () => {
    const res = await fetch(`${APP_BASE}/login`);
    expect(res.status).toBe(200);
    for (const h of REQUIRED_HEADERS) {
      expect(res.headers.get(h), `${h} missing on /login`).toBeTruthy();
    }
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  itHttp("and on an API response", async () => {
    const res = await fetch(`${APP_BASE}/api/pdf/processing/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(401);
    for (const h of ["x-frame-options", "x-content-type-options", "referrer-policy"]) {
      expect(res.headers.get(h), `${h} missing on the API response`).toBeTruthy();
    }
  });

  itHttp("and on the PWA resources", async () => {
    for (const p of ["/sw.js", "/manifest.webmanifest"]) {
      const res = await fetch(`${APP_BASE}${p}`);
      expect(res.headers.get("x-content-type-options"), `nosniff missing on ${p}`).toBe("nosniff");
    }
  });

  // M-01: both are fetched from the login screen, before a session exists.
  itHttp("the service worker is reachable unauthenticated, as JavaScript", async () => {
    const res = await fetch(`${APP_BASE}/sw.js`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/javascript/i);
  });

  itHttp("the manifest is reachable unauthenticated, as a manifest", async () => {
    const res = await fetch(`${APP_BASE}/manifest.webmanifest`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/manifest\+json|application\/json/i);
  });

  itHttp("protected routes still redirect, and the protected API still refuses", async () => {
    const page = await fetch(`${APP_BASE}/owner`, { redirect: "manual" });
    expect([302, 307]).toContain(page.status);
    const api = await fetch(`${APP_BASE}/api/pdf/dossier/00000000-0000-0000-0000-000000000000`);
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type") ?? "").toContain("application/json");
  });

  // L-03: the worker must never cache authenticated data.
  itHttp("the service worker caches nothing and handles navigations only", async () => {
    const body = await (await fetch(`${APP_BASE}/sw.js`)).text();
    expect(body).toMatch(/mode !== "navigate"/);
    expect(body).not.toMatch(/caches\.(open|match|put)/);
    expect(body).not.toMatch(/cache\.put|cacheName/);
  });
});
