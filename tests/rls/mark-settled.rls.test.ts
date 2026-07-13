import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The general accountant (New-Site) pays every site's transactions; a site
// accountant elsewhere is scoped to their own site.
describe("accountant marks settlement paid", () => {
  let newSite: string, otherSite: string, monazite: string;
  let genAcct: TestUser, siteAcct: TestUser, recv: TestUser;
  let supplierId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site")!.id as string;
    genAcct = await makeUser({ username: "ms-gacct", role: "accounting", siteId: newSite });   // general
    siteAcct = await makeUser({ username: "ms-sacct", role: "accounting", siteId: otherSite }); // site-scoped
    recv = await makeUser({ username: "ms-recv", role: "receiving", siteId: newSite });
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

  it("general accountant pays an OWN-site (New-Site) settlement → stocked", async () => {
    const { visitId, settlementId } = await seed(newSite);
    const { error } = await genAcct.client.from("batch_settlements").update({ status: "paid" }).eq("id", settlementId);
    expect(error).toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("stocked");
  });

  it("general accountant pays a CROSS-site settlement → stocked", async () => {
    const { visitId, settlementId } = await seed(otherSite);
    const { error } = await genAcct.client.from("batch_settlements").update({ status: "paid" }).eq("id", settlementId);
    expect(error).toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("stocked");
  });

  it("a site accountant cannot pay another site's settlement", async () => {
    const { settlementId } = await seed(newSite); // New-Site settlement
    await siteAcct.client.from("batch_settlements").update({ status: "paid" }).eq("id", settlementId); // siteAcct is at otherSite
    const { data: st } = await adminClient().from("batch_settlements").select("status").eq("id", settlementId).single();
    expect(st!.status).toBe("approved"); // unchanged — RLS blocked it
  });
});
