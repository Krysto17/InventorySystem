import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs } from "../setup/approvals";

// Phase 10 (D): hybrid edit policy — the author edits until the next stage
// acts, then manager/owner only. RLS UPDATE denials surface as 0 rows changed.
describe("hybrid record locking (integration)", () => {
  let siteId: string;
  let recv: TestUser, qc: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, monaziteId: string;

  async function batchInQc() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_qc", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, recorded_by: recv.userId,
    }).select("id").single();
    return { visitId: v!.id as string, lineId: line!.id as string };
  }

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    recv  = await makeUser({ username: "lock-recv", role: "receiving", siteId });
    qc    = await makeUser({ username: "lock-qc",   role: "qc",        siteId });
    mgr   = await makeUser({ username: "lock-mgr",  role: "manager",   siteId });
    owner = await makeUser({ username: "lock-owner", role: "owner",    siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Lock Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient()
      .from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = m!.id as string;
  });

  it("receiving edits its line while in_receiving, but not once QC starts", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, recorded_by: recv.userId,
    }).select("id").single();

    // While in_receiving: edit succeeds
    await recv.client.from("visit_materials").update({ weight_kg: 110 }).eq("id", line!.id);
    let { data: row } = await adminClient().from("visit_materials").select("weight_kg").eq("id", line!.id).single();
    expect(Number(row!.weight_kg)).toBe(110);

    // QC starts (receiving submits the batch) → receiving is locked out (0 rows updated)
    expect((await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v!.id })).error).toBeNull();
    await recv.client.from("visit_materials").update({ weight_kg: 999 }).eq("id", line!.id);
    ({ data: row } = await adminClient().from("visit_materials").select("weight_kg").eq("id", line!.id).single());
    expect(Number(row!.weight_kg)).toBe(110);

    // Manager and owner can still correct
    await mgr.client.from("visit_materials").update({ weight_kg: 115 }).eq("id", line!.id);
    ({ data: row } = await adminClient().from("visit_materials").select("weight_kg").eq("id", line!.id).single());
    expect(Number(row!.weight_kg)).toBe(115);
    await owner.client.from("visit_materials").update({ weight_kg: 120 }).eq("id", line!.id);
    ({ data: row } = await adminClient().from("visit_materials").select("weight_kg").eq("id", line!.id).single());
    expect(Number(row!.weight_kg)).toBe(120);
  });

  it("QC edits its XRF through the pricing stages, then is locked at accounting (owner can)", async () => {
    const { visitId, lineId } = await batchInQc();
    const { error } = await qc.client.from("xrf_records").insert({
      visit_material_id: lineId, result: "v1", recorded_by: qc.userId,
    });
    expect(error).toBeNull();
    const { data: x } = await adminClient().from("xrf_records").select("id").eq("visit_material_id", lineId).single();

    // in_qc: QC can edit
    await qc.client.from("xrf_records").update({ result: "v2" }).eq("id", x!.id);
    let { data: row } = await adminClient().from("xrf_records").select("result").eq("id", x!.id).single();
    expect(row!.result).toBe("v2");

    // Even in pricing (e.g. after a manager skipped analysis) QC can still analyse (#4)
    expect((await mgr.client.rpc("manager_skip_to_pricing", { p_visit_id: visitId })).error).toBeNull();
    await qc.client.from("xrf_records").update({ result: "v3" }).eq("id", x!.id);
    ({ data: row } = await adminClient().from("xrf_records").select("result").eq("id", x!.id).single());
    expect(row!.result).toBe("v3");

    // Once the batch reaches accounting, QC is locked. XRF is read-only for the
    // owner too, so the owner cannot change it either — it stays as QC left it.
    // The real route to accounting: an agreed price, then the owner's approval.
    expect((await owner.client.from("pricing").insert({
      visit_id: visitId, unit_price: 100, agreement_status: "agreed", payment_terms: "immediate", priced_by: owner.userId,
    })).error).toBeNull();
    expect((await approvePricingAs(owner.client, visitId)).error).toBeNull();
    expect((await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state).toBe("in_accounting");
    await qc.client.from("xrf_records").update({ result: "v4" }).eq("id", x!.id);
    ({ data: row } = await adminClient().from("xrf_records").select("result").eq("id", x!.id).single());
    expect(row!.result).toBe("v3"); // QC locked at accounting

    await owner.client.from("xrf_records").update({ result: "owner-fix" }).eq("id", x!.id);
    ({ data: row } = await adminClient().from("xrf_records").select("result").eq("id", x!.id).single());
    expect(row!.result).toBe("v3"); // owner is read-only for XRF
  });
});
