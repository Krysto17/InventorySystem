import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The manager (own site) may correct a batch line — e.g. a kg fix — after it
// leaves receiving, while the visit is still open. A different-site manager
// cannot.
describe("manager corrects a batch line after receiving", () => {
  let siteId: string, otherSiteId: string;
  let recv: TestUser, mgr: TestUser, mgr2: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name").order("name");
    siteId = sites![0].id as string;
    otherSiteId = sites!.find((s) => s.id !== siteId)!.id as string;
    recv = await makeUser({ username: "mel-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "mel-mgr", role: "manager", siteId });
    mgr2 = await makeUser({ username: "mel-mgr2", role: "manager", siteId: otherSiteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "MEL Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  async function lineInState(state: string) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: l } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, recorded_by: recv.userId,
    }).select("id").single();
    if (state !== "in_receiving") await adminClient().from("visits").update({ state }).eq("id", v!.id);
    return { visitId: v!.id as string, lineId: l!.id as string };
  }

  it("manager fixes a line's kg once the batch is in QC", async () => {
    const { lineId } = await lineInState("in_qc");
    const { error } = await mgr.client.from("visit_materials").update({ weight_kg: 110 }).eq("id", lineId);
    expect(error).toBeNull();
    const { data } = await adminClient().from("visit_materials").select("weight_kg").eq("id", lineId).single();
    expect(Number(data!.weight_kg)).toBe(110);
  });

  it("manager can also correct at the pricing stage", async () => {
    const { lineId } = await lineInState("pricing");
    const { error } = await mgr.client.from("visit_materials").update({ weight_kg: 88 }).eq("id", lineId);
    expect(error).toBeNull();
    const { data } = await adminClient().from("visit_materials").select("weight_kg").eq("id", lineId).single();
    expect(Number(data!.weight_kg)).toBe(88);
  });

  it("a different-site manager cannot edit the line", async () => {
    const { lineId } = await lineInState("in_qc");
    await mgr2.client.from("visit_materials").update({ weight_kg: 999 }).eq("id", lineId);
    const { data } = await adminClient().from("visit_materials").select("weight_kg").eq("id", lineId).single();
    expect(Number(data!.weight_kg)).toBe(100); // unchanged
  });
});
