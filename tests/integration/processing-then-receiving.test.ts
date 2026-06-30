import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// After processing records an iron line and the visit advances to receiving,
// receiving must be able to add MORE material lines.
describe("processing iron line → receiving adds more lines", () => {
  let siteId: string, proc: TestUser, recv: TestUser, ironId: string, monaziteId: string, supplierId: string;
  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    proc = await makeUser({ username: "ptr-proc", role: "processing", siteId });
    recv = await makeUser({ username: "ptr-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "PTR Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: fe } = await adminClient().from("material_types").select("id").eq("name", "Iron").single();
    ironId = fe!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  it("processing adds iron, advances to receiving, then receiving adds another line", async () => {
    const { data: v } = await proc.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: ironId,
      entry_path: "unprocessed", state: "in_processing", created_by: proc.userId,
    }).select("id").single();

    // processing records the iron line (state in_processing)
    const ironLine = await proc.client.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: ironId, weight_kg: 200, recorded_by: proc.userId,
    });
    expect(ironLine.error).toBeNull();

    // processing_record advances the visit in_processing → in_receiving (trigger)
    await proc.client.from("processing_records").insert({ visit_id: v!.id, recorded_by: proc.userId, completed_at: new Date().toISOString() });
    const { data: st } = await adminClient().from("visits").select("state").eq("id", v!.id).single();
    expect(st!.state).toBe("in_receiving");

    // receiving adds another material line
    const recvLine = await recv.client.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 50, recorded_by: recv.userId,
    });
    expect(recvLine.error).toBeNull();

    const { data: lines } = await adminClient().from("visit_materials").select("id").eq("visit_id", v!.id);
    expect((lines ?? []).length).toBe(2);
  });
});
