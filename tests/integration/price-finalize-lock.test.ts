import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Pricing authority: manager sets draft prices; once the owner finalizes a
// line, the manager can no longer change it; only the owner may finalize.
describe("price finalize-lock", () => {
  let siteId: string;
  let mgr: TestUser, owner: TestUser;
  let supplierId: string, monaziteId: string;

  async function lineInPricing() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "pricing", created_by: mgr.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, recorded_by: mgr.userId,
    }).select("id").single();
    return line!.id as string;
  }

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    mgr   = await makeUser({ username: "pfl-mgr",  role: "manager", siteId });
    owner = await makeUser({ username: "pfl-owner", role: "owner",  siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "PFL Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = m!.id as string;
  });

  it("manager sets a draft price; manager cannot finalize", async () => {
    const lineId = await lineInPricing();
    const ok = await mgr.client.from("visit_materials").update({ unit_price: 100, priced_by: mgr.userId }).eq("id", lineId);
    expect(ok.error).toBeNull();
    const tryFinalize = await mgr.client.from("visit_materials").update({ price_finalized: true }).eq("id", lineId);
    expect(tryFinalize.error).not.toBeNull();
  });

  it("owner finalizes; manager can no longer change the price; owner still can", async () => {
    const lineId = await lineInPricing();
    await mgr.client.from("visit_materials").update({ unit_price: 100 }).eq("id", lineId);

    const fin = await owner.client.from("visit_materials").update({ price_finalized: true }).eq("id", lineId);
    expect(fin.error).toBeNull();
    const { data: after } = await adminClient().from("visit_materials")
      .select("price_finalized, finalized_by").eq("id", lineId).single();
    expect(after!.price_finalized).toBe(true);
    expect(after!.finalized_by).toBe(owner.userId);

    // Manager attempt to change the finalized price is rejected
    const mgrChange = await mgr.client.from("visit_materials").update({ unit_price: 999 }).eq("id", lineId);
    expect(mgrChange.error).not.toBeNull();
    const { data: still } = await adminClient().from("visit_materials").select("unit_price").eq("id", lineId).single();
    expect(Number(still!.unit_price)).toBe(100);

    // Owner can still override the finalized price
    const ownerChange = await owner.client.from("visit_materials").update({ unit_price: 250 }).eq("id", lineId);
    expect(ownerChange.error).toBeNull();
    const { data: overridden } = await adminClient().from("visit_materials").select("unit_price").eq("id", lineId).single();
    expect(Number(overridden!.unit_price)).toBe(250);
  });
});
