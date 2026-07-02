import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("XRF read-only for owner + manager deletes pending advance", () => {
  let siteId: string, qc: TestUser, owner: TestUser, mgr: TestUser, recv: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    qc = await makeUser({ username: "oxa-qc", role: "qc", siteId });
    owner = await makeUser({ username: "oxa-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "oxa-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "oxa-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `OXA ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  it("owner cannot record an XRF (read-only), but QC can", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 50, recorded_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visits").update({ state: "in_qc" }).eq("id", v!.id);

    const ownerTry = await owner.client.from("xrf_records").insert({ visit_material_id: line!.id, result: "owner", recorded_by: owner.userId });
    expect(ownerTry.error).not.toBeNull(); // owner is read-only for XRF

    const qcTry = await qc.client.from("xrf_records").insert({ visit_material_id: line!.id, result: "qc", recorded_by: qc.userId });
    expect(qcTry.error).toBeNull();
  });

  it("manager deletes a pending advance but not an approved one", async () => {
    const { data: pend } = await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "seed", amount_naira: 1000, approval_status: "pending", recorded_by: mgr.userId,
    }).select("id").single();
    await mgr.client.from("advances").delete().eq("id", pend!.id);
    const { data: gone } = await adminClient().from("advances").select("id").eq("id", pend!.id);
    expect(gone ?? []).toHaveLength(0);

    const { data: appr } = await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "seed2", amount_naira: 2000, approval_status: "approved", recorded_by: mgr.userId,
    }).select("id").single();
    await mgr.client.from("advances").delete().eq("id", appr!.id);
    const { data: still } = await adminClient().from("advances").select("id").eq("id", appr!.id);
    expect(still ?? []).toHaveLength(1); // approved advance can't be deleted by manager
  });
});
