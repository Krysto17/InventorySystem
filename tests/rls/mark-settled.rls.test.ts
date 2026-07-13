import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The accountant (central role) marks settlements paid at any site — the payouts
// queue is cross-site, so paying must be cross-site too.
describe("accountant marks settlement paid", () => {
  let siteA: string, siteB: string, monazite: string;
  let acct: TestUser, recv: TestUser;
  let supplierId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name === "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site")!.id as string;
    acct = await makeUser({ username: "ms-acct", role: "accounting", siteId: siteA });
    recv = await makeUser({ username: "ms-recv", role: "receiving", siteId: siteA });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `MS ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function seed(site: string) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: site, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 100, unit_price: 50, requires_analysis: false, recorded_by: recv.userId,
    });
    const { data: st } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: site, materials_total: 5000, light_bill_total: 0, advance_deducted: 0,
      net_balance: 5000, submitted_by: recv.userId, status: "approved", approved_by: recv.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return { visitId: v!.id as string, settlementId: st!.id as string };
  }

  it("marks an OWN-site settlement paid → visit stocked", async () => {
    const { visitId, settlementId } = await seed(siteA);
    const { error } = await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", settlementId);
    expect(error).toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("stocked");
  });

  it("marks a CROSS-site settlement paid → visit stocked", async () => {
    const { visitId, settlementId } = await seed(siteB);
    const { error } = await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", settlementId);
    expect(error).toBeNull();
    const { data: st } = await adminClient().from("batch_settlements").select("status").eq("id", settlementId).single();
    expect(st!.status).toBe("paid");
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("stocked");
  });
});
