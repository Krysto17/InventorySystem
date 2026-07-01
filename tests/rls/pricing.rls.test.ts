import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("pricing RLS + transition + purchase_amount", () => {
  let siteAId: string;
  let mgrA: TestUser, recvA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newPricingVisitWithAnalysis(weight: number) {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteAId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_receiving",
        created_by: mgrA.userId,
      })
      .select("id")
      .single();
    await adminClient()
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight, recorded_by: recvA.userId });
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteAId = sites![0].id as string;
    mgrA = await makeUser({ username: "pp-mgr-a", role: "manager", siteId: siteAId });
    recvA = await makeUser({ username: "pp-recv-a", role: "receiving", siteId: siteAId });
    owner = await makeUser({ username: "pp-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "PP Supp", phone: "07044440000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("manager's agreed price parks at owner approval; owner approve → in_accounting", async () => {
    const vid = await newPricingVisitWithAnalysis(300);
    const { error } = await mgrA.client.from("pricing").insert({
      visit_id: vid,
      unit_price: 1200,
      agreement_status: "agreed",
      payment_terms: "immediate",
      priced_by: mgrA.userId,
    });
    expect(error).toBeNull();
    let { data: v } = await adminClient().from("visits").select("state").eq("id", vid).single();
    expect(v?.state).toBe("awaiting_price_approval"); // owner gate (#1/#5)

    const { error: aErr } = await owner.client.rpc("approve_pricing", { p_visit_id: vid });
    expect(aErr).toBeNull();
    ({ data: v } = await adminClient().from("visits").select("state").eq("id", vid).single());
    expect(v?.state).toBe("in_accounting");
  });

  it("purchase_amount = unit_price × weight", async () => {
    const vid = await newPricingVisitWithAnalysis(250);
    await mgrA.client.from("pricing").insert({
      visit_id: vid,
      unit_price: 1500,
      agreement_status: "pending",
      priced_by: mgrA.userId,
    });
    const { data: p } = await adminClient()
      .from("pricing")
      .select("purchase_amount")
      .eq("visit_id", vid)
      .single();
    expect(Number(p?.purchase_amount)).toBe(250 * 1500);
  });

  it("agreed without unit_price violates CHECK constraint", async () => {
    const vid = await newPricingVisitWithAnalysis(100);
    const { error } = await mgrA.client.from("pricing").insert({
      visit_id: vid,
      agreement_status: "agreed",
      payment_terms: "immediate",
      priced_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("agreed without payment_terms violates CHECK constraint", async () => {
    const vid = await newPricingVisitWithAnalysis(100);
    const { error } = await mgrA.client.from("pricing").insert({
      visit_id: vid,
      unit_price: 1000,
      agreement_status: "agreed",
      priced_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("not_agreed parks the visit at awaiting_gate_exit (gate release pending)", async () => {
    const vid = await newPricingVisitWithAnalysis(50);
    await mgrA.client.from("pricing").insert({
      visit_id: vid,
      agreement_status: "not_agreed",
      priced_by: mgrA.userId,
    });
    const { data: v } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", vid)
      .single();
    expect(v?.state).toBe("awaiting_gate_exit");
  });

  it("analysis weight edit recomputes purchase_amount", async () => {
    const vid = await newPricingVisitWithAnalysis(100);
    await mgrA.client.from("pricing").insert({
      visit_id: vid,
      unit_price: 2000,
      agreement_status: "pending",
      priced_by: mgrA.userId,
    });
    await adminClient().from("analysis_records").update({ weight: 110 }).eq("visit_id", vid);
    const { data: p } = await adminClient()
      .from("pricing")
      .select("purchase_amount")
      .eq("visit_id", vid)
      .single();
    expect(Number(p?.purchase_amount)).toBe(110 * 2000);
  });

  it("non-manager role cannot insert pricing", async () => {
    const vid = await newPricingVisitWithAnalysis(50);
    const { error } = await recvA.client.from("pricing").insert({
      visit_id: vid,
      unit_price: 1000,
      agreement_status: "pending",
      priced_by: recvA.userId,
    });
    expect(error).not.toBeNull();
  });
});
