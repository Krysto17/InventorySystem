import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { APP_BASE, requireAppServer } from "../setup/app-server";

/**
 * PDF route access control, over real HTTP.
 *
 * PRE: this application must be running at NEXT_PUBLIC_SITE_URL (default
 * http://localhost:3000) — `npm run build && npx next start`.
 *
 * The probe verifies it is talking to THIS app, not merely to something. An
 * unrelated service on the port aborts the suite rather than producing
 * plausible-looking failures; see tests/setup/app-server.ts.
 */

const BASE = APP_BASE;

describe("PDF route access control", () => {
  let siteId: string;
  let visitId: string;
  let ownerCookies: string;
  let signInHelper: (u: string, p?: string) => Promise<string>;
  let recvCookies: string;
  let materialTypeId: string;
  let supplierId: string;
  let owner: TestUser;
  let recv: TestUser;

  let serverUp = false;

  beforeAll(async () => {
    serverUp = await requireAppServer();
    if (!serverUp) return;

    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    owner = await makeUser({ username: "pdf-owner", role: "owner", siteId: null });
    recv  = await makeUser({ username: "pdf-recv",  role: "receiving",  siteId });

    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: s } = await adminClient()
      .from("suppliers").insert({ name: "PDF Supplier", phone: "07099001122" }).select("id").single();
    supplierId = s!.id as string;

    // Seed a visit that reached accounting
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_accounting",
        created_by: recv.userId,
      })
      .select("id")
      .single();
    visitId = v!.id as string;

    // Sign in to get session cookies
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";

    async function signIn(username: string, password = "test-password-123") {
      const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey },
        body: JSON.stringify({ email: `${username}@${domain}`, password }),
      });
      const session = await r.json() as Record<string, unknown>;
      // @supabase/ssr (>=0.5) stores the full session JSON base64-encoded with a
      // `base64-` prefix under sb-<host>-auth-token. Mirror that exactly.
      const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
      return `sb-127-auth-token=${value}`;
    }

    signInHelper = signIn;
    [ownerCookies, recvCookies] = await Promise.all([
      signIn("pdf-owner"),
      signIn("pdf-recv"),
    ]);
  });

  // M-05: the proxy does not run on /api, so the route must enforce the forced
  // password change itself. Without this a temp password handed over WhatsApp
  // was enough to pull business documents.
  it("a user who must change their password cannot use the PDF API", async () => {
    if (!serverUp) return;
    const { data: sites } = await adminClient().from("sites").select("id").limit(1).single();
    const username = `pdf-newuser-${Date.now()}`;
    await makeUser({ username, role: "owner", siteId: null });
    await adminClient().from("profiles").update({ must_change_password: true })
      .eq("username", username);

    const cookies = await signInHelper(username);
    const r = await fetch(`${BASE}/api/pdf/analysis/${visitId}`, { headers: { cookie: cookies } });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(String(body.error)).toMatch(/password/i);
    expect(sites).toBeTruthy();
  });

  it("unauthenticated request to PDF route returns 401", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/analysis/${visitId}`);
    expect(r.status).toBe(401);
  });

  it("receiving user can download analysis PDF (200 + PDF content-type)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/analysis/${visitId}`, {
      headers: { Cookie: recvCookies },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
  });

  it("receiving user cannot download pricing sheet (403)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/pricing/${visitId}`, {
      headers: { Cookie: recvCookies },
    });
    expect(r.status).toBe(403);
  });

  it("receiving user cannot download full dossier (403)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/dossier/${visitId}`, {
      headers: { Cookie: recvCookies },
    });
    expect(r.status).toBe(403);
  });

  it("owner can download full dossier (200 + PDF)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/dossier/${visitId}`, {
      headers: { Cookie: ownerCookies },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
  });

  it("invalid PDF type returns 400", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/unknown/${visitId}`, {
      headers: { Cookie: ownerCookies },
    });
    expect(r.status).toBe(400);
  });

  it("unknown visitId returns 404", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/processing/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: ownerCookies },
    });
    expect(r.status).toBe(404);
  });
});
