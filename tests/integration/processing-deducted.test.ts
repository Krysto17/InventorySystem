import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("processing_deducted flag", () => {
  let siteId: string;
  let acct: TestUser;
  let supplierId: string, materialTypeId: string, machineId: string;

  async function newUnprocessedAccountingVisit() {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "in_processing",
        created_by: acct.userId,
      })
      .select("id")
      .single();

    // Processing record with fee = 100kg × ₦10 = ₦1000
    const { data: pr } = await adminClient()
      .from("processing_records")
      .insert({ visit_id: v!.id, recorded_by: acct.userId })
      .select("id")
      .single();
    await adminClient().from("processing_machine_usage").insert({
      processing_record_id: pr!.id,
      machine_id: machineId,
      measurement: 100,
      rate_snapshot: 10,
    });

    // Analysis (trigger moves to pricing)
    await adminClient().from("analysis_records").insert({
      visit_id: v!.id,
      weight: 200,
      recorded_by: acct.userId,
    });

    // Pricing agreed (purchase_amount = 200 × ₦50 = ₦10000)
    await adminClient().from("pricing").insert({
      visit_id: v!.id,
      unit_price: 50,
      agreement_status: "agreed",
      payment_terms: "deducted",
      priced_by: acct.userId,
    });

    await adminClient().from("visits").update({ state: "in_accounting" }).eq("id", v!.id);
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    acct = await makeUser({ username: "ded-acct", role: "accounting", siteId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Ded Supp", phone: "07099887766" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: mc } = await adminClient()
      .from("machines")
      .insert({ site_id: siteId, name: "Ded Crusher", charge_basis: "weight", rate: 10 })
      .select("id")
      .single();
    machineId = mc!.id as string;
  });

  it("accounting can toggle processing_deducted flag", async () => {
    const vid = await newUnprocessedAccountingVisit();

    const { error } = await acct.client
      .from("visits")
      .update({ processing_deducted: true })
      .eq("id", vid);
    expect(error).toBeNull();

    const { data } = await adminClient()
      .from("visits")
      .select("processing_deducted")
      .eq("id", vid)
      .single();
    expect(data?.processing_deducted).toBe(true);
  });

  it("processing fee and purchase amount are independently accessible", async () => {
    const vid = await newUnprocessedAccountingVisit();

    // Verify processing fee (sum of line_cost via processing_records)
    const { data: pr } = await adminClient()
      .from("processing_records")
      .select("usage:processing_machine_usage(line_cost)")
      .eq("visit_id", vid)
      .single();
    const fee = ((pr as { usage: { line_cost: number }[] }).usage ?? []).reduce(
      (s: number, u: { line_cost: number }) => s + Number(u.line_cost),
      0,
    );
    expect(fee).toBe(1000);

    // Verify purchase_amount
    const { data: p } = await adminClient()
      .from("pricing")
      .select("purchase_amount")
      .eq("visit_id", vid)
      .single();
    expect(Number(p?.purchase_amount)).toBe(10000);
  });
});
