import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("xrf_records RLS (confidential QC results)", () => {
  let siteAId: string, siteBId: string;
  let qcA: TestUser, qcB: TestUser, mgrA: TestUser, recvA: TestUser, acctA: TestUser, invA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newVisitWithLine(siteId: string, state = "in_qc") {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "processed", state: "in_receiving", created_by: qcA.userId,
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

  it("QC (cross-site) can record an XRF for another site's line", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    const { error } = await qcB.client.from("xrf_records").insert({
      visit_material_id: lineId, result: "cross-site", recorded_by: qcB.userId,
    });
    expect(error).toBeNull(); // the New-Site QC analyses every site (#cross-site QC)
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

  it("QC (cross-site) can read another site's XRF result", async () => {
    const { lineId } = await newVisitWithLine(siteAId);
    await adminClient().from("xrf_records").insert({
      visit_material_id: lineId, result: "secret", submitted: true, recorded_by: qcA.userId,
    });
    const { data } = await qcB.client.from("xrf_records").select("result").eq("visit_material_id", lineId);
    expect(data ?? []).toHaveLength(1); // cross-site QC reads every site's XRF
  });

  // ── QC is a ROLE, not an ownership boundary ───────────────────────────────
  //
  // The SELECT and UPDATE policies name `current_role() = 'qc'` with no
  // recorded_by predicate, so authorization follows the role rather than who
  // typed the result. 0076_cross_site_qc.sql says why: one analyst, at
  // New-Site, analyses every site's material, and may "record/edit the XRF for
  // any site's visit while it is in the analysis→pricing window".
  //
  // /qc/analyses filters `.eq("recorded_by", me.id)` so an analyst sees their
  // own sheet, but that is a workflow convenience. These tests go straight at
  // the table so the difference between the two is written down: the filter is
  // NOT the security boundary, and nobody should later mistake it for one.
  describe("QC authorization is role-wide, not per-analyst", () => {
    it("a QC user can read an XRF record another QC user created", async () => {
      const { lineId } = await newVisitWithLine(siteAId);
      await adminClient().from("xrf_records").insert({
        visit_material_id: lineId, result: "recorded by A", submitted: true, recorded_by: qcA.userId,
      });
      // qcB did not record this and is not even on the same site.
      const { data, error } = await qcB.client
        .from("xrf_records").select("result, recorded_by").eq("visit_material_id", lineId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
      expect(data![0].recorded_by).toBe(qcA.userId);
    });

    it("a QC user can edit another QC user's record while the visit is still open", async () => {
      // The UPDATE policy gates on visit state, not on authorship: in_qc,
      // pricing and awaiting_price_approval are the editable window.
      const { lineId } = await newVisitWithLine(siteAId, "in_qc");
      const { data: rec } = await adminClient().from("xrf_records").insert({
        visit_material_id: lineId, result: "A's original", weight_kg: 100, recorded_by: qcA.userId,
      }).select("id").single();

      const { error } = await qcB.client
        .from("xrf_records").update({ result: "edited by B" }).eq("id", rec!.id);
      expect(error).toBeNull();

      // Prove the row actually changed — a refused write returns no error and
      // no rows, so the absence of an error proves nothing on its own.
      const { data: after } = await adminClient()
        .from("xrf_records").select("result, recorded_by").eq("id", rec!.id).single();
      expect(after!.result).toBe("edited by B");
      // Editing does not reassign authorship; recorded_by still names A.
      expect(after!.recorded_by).toBe(qcA.userId);
    });

    it("but not once the visit has left the editable window", async () => {
      const { visitId, lineId } = await newVisitWithLine(siteAId, "in_qc");
      // `submitted` matters: the state machine refuses to enter pricing without a
      // submitted XRF result or an analysis_records row.
      const { data: rec } = await adminClient().from("xrf_records").insert({
        visit_material_id: lineId, result: "locked", weight_kg: 100,
        submitted: true, recorded_by: qcA.userId,
      }).select("id").single();

      // Walk the legal path — in_qc -> pricing -> in_accounting (0114). A direct
      // jump raises, and a discarded error here would leave the visit in_qc and
      // make this test silently assert nothing.
      for (const state of ["pricing", "in_accounting"]) {
        const { error } = await adminClient().from("visits").update({ state }).eq("id", visitId);
        expect(error, `could not move the visit to ${state}: ${error?.message}`).toBeNull();
      }
      const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
      expect(v!.state).toBe("in_accounting"); // the gate is only meaningful if we got here

      await qcB.client.from("xrf_records").update({ result: "too late" }).eq("id", rec!.id);
      const { data: after } = await adminClient()
        .from("xrf_records").select("result").eq("id", rec!.id).single();
      expect(after!.result).toBe("locked");
    });

    it("no QC user may delete an XRF record — there is no delete policy at all", async () => {
      const { lineId } = await newVisitWithLine(siteAId, "in_qc");
      const { data: rec } = await adminClient().from("xrf_records").insert({
        visit_material_id: lineId, result: "permanent", weight_kg: 100, recorded_by: qcA.userId,
      }).select("id").single();

      // Their own record, in the editable window — still refused.
      await qcA.client.from("xrf_records").delete().eq("id", rec!.id);
      await qcB.client.from("xrf_records").delete().eq("id", rec!.id);
      const { count } = await adminClient()
        .from("xrf_records").select("id", { count: "exact", head: true }).eq("id", rec!.id);
      expect(count).toBe(1);
    });
  });
});
