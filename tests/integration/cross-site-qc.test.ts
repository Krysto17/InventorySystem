import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The New-Site QC analyses another site's visit (only one QC employee, at New-Site).
describe("cross-site QC", () => {
  let newSiteId: string, otherSiteId: string, qc: TestUser, recv: TestUser;
  let supplierId: string, monaziteId: string;
  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSiteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    otherSiteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    qc = await makeUser({ username: "csq-qc", role: "qc", siteId: newSiteId });
    recv = await makeUser({ username: "csq-recv", role: "receiving", siteId: otherSiteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `CSQ ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  it("New-Site QC reads and records an XRF for another site's visit", async () => {
    const { data: v } = await recv.client.from("visits").insert({
      site_id: otherSiteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await recv.client.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 40, recorded_by: recv.userId,
    }).select("id").single();
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v!.id }); // → in_qc (other site)

    // New-Site QC can see the other-site visit + line, and record its XRF.
    const rv = await qc.client.from("visits").select("id").eq("id", v!.id);
    expect(rv.data ?? []).toHaveLength(1);
    const rl = await qc.client.from("visit_materials").select("id").eq("id", line!.id);
    expect(rl.data ?? []).toHaveLength(1);
    const ins = await qc.client.from("xrf_records").insert({ visit_material_id: line!.id, result: "Sn 55%", recorded_by: qc.userId });
    expect(ins.error).toBeNull();
  });
});
