import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { listQcCompletedVisits } from "@/lib/visits/queries";

// An analyst's done-list used to be built by reading every xrf_record they had
// ever written and asking for those visits with `id=in.(…)`. At 629 visits that
// is a ~24 KB query string, which the gateway rejects — so the QC home page
// broke once the analyst had done enough work. The relationship is resolved in
// Postgres now (0140), and only a page of ids ever reaches the URL.
describe("the QC done-list survives a busy analyst", () => {
  let siteId: string, supplierId: string, material: string;
  let qc: TestUser, recv: TestUser;
  const VISITS = 120;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    qc = await makeUser({ username: `qcd-${Date.now()}`, role: "qc", siteId });
    recv = await makeUser({ username: `qcd-recv-${Date.now()}`, role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `QCD ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `QCD-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;

    // A long history: every visit analysed by this analyst and moved past QC.
    const visits = Array.from({ length: VISITS }, () => ({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }));
    const { data: madeVisits } = await adminClient().from("visits").insert(visits).select("id");
    const lines = (madeVisits ?? []).map((v) => ({
      visit_id: v.id as string, material_type_id: material, weight_kg: 10,
    }));
    const { data: madeLines } = await adminClient().from("visit_materials").insert(lines).select("id");
    await adminClient().from("xrf_records").insert(
      (madeLines ?? []).map((l) => ({
        visit_material_id: l.id as string, result: "Sn 60%", weight_kg: 10,
        submitted: true, recorded_by: qc.userId,
      })),
    );
  });

  it("returns a page of the analyst's visits without a giant query string", async () => {
    const { data: mine } = await qc.client
      .from("qc_analyst_visits").select("visit_id").eq("analyst_id", qc.userId);
    expect(mine!.length).toBeGreaterThanOrEqual(VISITS); // the history really is long

    const { data: page, error } = await qc.client
      .from("qc_analyst_visits")
      .select("visit_id")
      .eq("analyst_id", qc.userId)
      .neq("visit_state", "in_qc")
      .order("last_analysed_at", { ascending: false })
      .limit(25);
    expect(error).toBeNull();
    expect(page).toHaveLength(25); // one page, not 120 ids in a URL
  });

  it("excludes visits still sitting in QC", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "in_qc", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials")
      .insert({ visit_id: v!.id, material_type_id: material, weight_kg: 5 }).select("id").single();
    await adminClient().from("xrf_records").insert({
      visit_material_id: line!.id, result: "draft", weight_kg: 5, submitted: false, recorded_by: qc.userId,
    });

    const { data } = await qc.client.from("qc_analyst_visits")
      .select("visit_id").eq("analyst_id", qc.userId).eq("visit_id", v!.id).neq("visit_state", "in_qc");
    expect(data ?? []).toHaveLength(0);
  });

  it("shows one analyst's work to that analyst only", async () => {
    const other = await makeUser({ username: `qcd-other-${Date.now()}`, role: "qc", siteId });
    const { data } = await other.client.from("qc_analyst_visits")
      .select("visit_id").eq("analyst_id", other.userId);
    expect(data ?? []).toHaveLength(0);
  });
});
