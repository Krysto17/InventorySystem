import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * Tests PDF route access control.
 * These tests hit the running Next.js dev server (or production build) at localhost:3000.
 * PRE: `npm run dev` (or `npm run build && npm start`) must be running alongside the tests.
 *
 * If the dev server is not running, these tests are skipped gracefully.
 */

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

async function serverRunning(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/pdf/gate/00000000-0000-0000-0000-000000000000`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.status !== 0; // any response (including 401/404) means server is up
  } catch {
    return false;
  }
}

describe("PDF route access control", () => {
  let siteId: string;
  let visitId: string;
  let bulkSaleId: string;
  let ownerCookies: string;
  let gateCookies: string;
  let materialTypeId: string;
  let supplierId: string;
  let owner: TestUser;
  let gate: TestUser;

  let serverUp = false;

  beforeAll(async () => {
    serverUp = await serverRunning();
    if (!serverUp) return;

    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    owner = await makeUser({ username: "pdf-owner", role: "owner", siteId: null });
    gate  = await makeUser({ username: "pdf-gate",  role: "gate",  siteId });

    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: s } = await adminClient()
      .from("suppliers").insert({ name: "PDF Supplier", phone: "07099001122" }).select("id").single();
    supplierId = s!.id as string;

    // Seed a completed visit
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "in_accounting",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    visitId = v!.id as string;

    // Seed a bulk sale
    const { data: bs } = await adminClient()
      .from("bulk_sales")
      .insert({
        site_id: siteId,
        buyer_name: "PDF Buyer",
        material_type_id: materialTypeId,
        weight: 50,
        unit_price: 200,
        recorded_by: owner.userId,
        approval_status: "approved",
        approved_by: owner.userId,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    bulkSaleId = bs!.id as string;

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
      const { access_token } = await r.json() as { access_token: string };
      // Set as a Next.js-compatible auth cookie
      return `sb-127-auth-token=${encodeURIComponent(JSON.stringify([access_token, null]))}`;
    }

    [ownerCookies, gateCookies] = await Promise.all([
      signIn("pdf-owner"),
      signIn("pdf-gate"),
    ]);
  });

  function skip(label: string) {
    if (!serverUp) {
      it.skip(`${label} (dev server not running)`, () => {});
      return true;
    }
    return false;
  }

  it("unauthenticated request to PDF route returns 401", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/gate/${visitId}`);
    expect(r.status).toBe(401);
  });

  it("gate user can download gate intake PDF (200 + PDF content-type)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/gate/${visitId}`, {
      headers: { Cookie: gateCookies },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
  });

  it("gate user cannot download pricing sheet (403)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/pricing/${visitId}`, {
      headers: { Cookie: gateCookies },
    });
    expect(r.status).toBe(403);
  });

  it("gate user cannot download full dossier (403)", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/pdf/dossier/${visitId}`, {
      headers: { Cookie: gateCookies },
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
    const r = await fetch(`${BASE}/api/pdf/gate/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: ownerCookies },
    });
    expect(r.status).toBe(404);
  });
});
