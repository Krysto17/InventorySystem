import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// After a manager skips analysis to pricing, QC can still run the analysis; and
// a manager pricing a multi-material batch (no analysis_records) still reaches
// the owner approval gate.
describe("QC analyses after skip + manager price submit → awaiting approval", () => {
  let siteId: string, recv: TestUser, qc: TestUser, mgr: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    recv = await makeUser({ username: "qafs-recv", role: "receiving", siteId });
    qc = await makeUser({ username: "qafs-qc", role: "qc", siteId });
    mgr = await makeUser({ username: "qafs-mgr", role: "manager", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `QAS ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  it("QC records an XRF even after the manager skipped analysis to pricing", async () => {
    const { data: v } = await recv.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await recv.client.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 60, recorded_by: recv.userId,
    }).select("id").single();

    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v!.id }); // → in_qc
    await mgr.client.rpc("manager_skip_to_pricing", { p_visit_id: v!.id });   // → pricing (exempt)
    const { data: st } = await adminClient().from("visits").select("state").eq("id", v!.id).single();
    expect(st!.state).toBe("pricing");

    // QC can still analyse the line even though the visit is now in pricing.
    const { error } = await qc.client.from("xrf_records").insert({
      visit_material_id: line!.id, result: "Sn 50%", recorded_by: qc.userId,
    });
    expect(error).toBeNull();

    // Manager prices the line, then agrees → visit parks at the owner gate (#3).
    await mgr.client.from("visit_materials").update({ unit_price: 100 }).eq("id", line!.id);
    const { error: pErr } = await mgr.client.from("pricing").insert({
      visit_id: v!.id, agreement_status: "agreed", payment_terms: "immediate", priced_by: mgr.userId,
    });
    expect(pErr).toBeNull();
    const { data: st2 } = await adminClient().from("visits").select("state").eq("id", v!.id).single();
    expect(st2!.state).toBe("awaiting_price_approval");
  });
});
