import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A site manager can add a material line while the batch is being priced, but
// not once it has left pricing (e.g. awaiting_price_approval).
describe("manager adds a material line at pricing", () => {
  let siteId: string, monazite: string;
  let mgr: TestUser, recv: TestUser;
  let supplierId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string; // plain site manager
    mgr = await makeUser({ username: "malp-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "malp-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `MALP ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function visitInState(state: string) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state, created_by: recv.userId,
    }).select("id").single();
    return v!.id as string;
  }

  it("adds a line while pricing", async () => {
    const visitId = await visitInState("pricing");
    const { error } = await mgr.client.from("visit_materials").insert({
      visit_id: visitId, material_type_id: monazite, weight_kg: 40, requires_analysis: false, recorded_by: mgr.userId,
    });
    expect(error).toBeNull();
    const { data } = await adminClient().from("visit_materials").select("id").eq("visit_id", visitId);
    expect(data ?? []).toHaveLength(1);
  });

  it("cannot add a line once submitted to owner (awaiting_price_approval)", async () => {
    const visitId = await visitInState("awaiting_price_approval");
    const { error } = await mgr.client.from("visit_materials").insert({
      visit_id: visitId, material_type_id: monazite, weight_kg: 40, requires_analysis: false, recorded_by: mgr.userId,
    });
    expect(error).not.toBeNull();
  });
});
