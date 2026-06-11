import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("xrf_records RLS (confidential QC results)", () => {
  let siteAId: string, siteBId: string;
  let qcA: TestUser, qcB: TestUser, mgrA: TestUser, recvA: TestUser, acctA: TestUser, invA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newVisitWithLine(siteId: string, state = "in_qc") {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "in_receiving", created_by: qcA.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: materialTypeId, weight_kg: 100, recorded_by: qcA.userId,
    }).select("id").single();
    if (state !== "in_receiving") {
      await adminClient().from("visits").update({ state }).eq("id", v!.id);
    }
    return { visitId: v!.id as string, lineId: line!.id as string };
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    qcA   = await makeUser({ username: "xrf-qc-a",   role: "qc",         siteId: siteAId });
    qcB   = await makeUser({ username: "xrf-qc-b",   role: "qc",         siteId: siteBId });
    mgrA  = await makeUser({ username: "xrf-mgr-a",  role: "manager",    siteId: siteAId });
    recvA = await makeUser({ username: "xrf-recv-a", role: "receiving",  siteId: siteAId });
    acctA = await makeUser({ username: "xrf-acct-a", role: "accounting", siteId: siteAId });
    invA  = await makeUser({ username: "xrf-inv-a",  role: "inventory",  siteId: siteAId });
    owner = await makeUser({ username: "xrf-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "XRF Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("QC at site A records an XRF result for an in_qc visit", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    const { error } = await qcA.client.from("xrf_records").insert({
      visit_material_id: lineId, result: "Sn 58%, Fe 12%", recorded_by: qcA.userId,
    });
    expect(error).toBeNull();
  });

  it("QC at site B cannot record an XRF for a site A line", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    const { error } = await qcB.client.from("xrf_records").insert({
      visit_material_id: lineId, result: "hack", recorded_by: qcB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("receiving cannot record an XRF result", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    const { error } = await recvA.client.from("xrf_records").insert({
      visit_material_id: lineId, result: "nope", recorded_by: recvA.userId,
    });
    expect(error).not.toBeNull();
  });

  // ── Confidentiality: only owner / manager / qc may READ the result ──────────

  it("manager and owner CAN read a submitted XRF result", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    await adminClient().from("xrf_records").insert({
      visit_material_id: lineId, result: "Confidential Sn 64%", submitted: true, recorded_by: qcA.userId,
    });
    const mgr = await mgrA.client.from("xrf_records").select("result").eq("visit_material_id", lineId);
    expect(mgr.data?.[0]?.result).toBe("Confidential Sn 64%");
    const own = await owner.client.from("xrf_records").select("result").eq("visit_material_id", lineId);
    expect(own.data?.[0]?.result).toBe("Confidential Sn 64%");
  });

  it("receiving / accounting / inventory CANNOT read XRF results", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    await adminClient().from("xrf_records").insert({
      visit_material_id: lineId, result: "secret", submitted: true, recorded_by: qcA.userId,
    });
    for (const u of [recvA, acctA, invA]) {
      const { data } = await u.client.from("xrf_records").select("result").eq("visit_material_id", lineId);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("QC at site B cannot read a site A XRF result", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    await adminClient().from("xrf_records").insert({
      visit_material_id: lineId, result: "secret", submitted: true, recorded_by: qcA.userId,
    });
    const { data } = await qcB.client.from("xrf_records").select("result").eq("visit_material_id", lineId);
    expect(data ?? []).toHaveLength(0);
  });
});
