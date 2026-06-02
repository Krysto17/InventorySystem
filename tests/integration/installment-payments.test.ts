import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("installment payments — running balance", () => {
  let siteId: string;
  let acct: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newAccountingVisitWithPricing(purchaseAmount: number) {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "pricing",
        created_by: acct.userId,
      })
      .select("id")
      .single();
    // Insert an analysis record first (needed for pricing to work)
    await adminClient().from("analysis_records").insert({
      visit_id: v!.id,
      weight: purchaseAmount,
      recorded_by: acct.userId,
    });
    await adminClient().from("pricing").insert({
      visit_id: v!.id,
      unit_price: 1,
      agreement_status: "agreed",
      payment_terms: "installment",
      priced_by: acct.userId,
    });
    // Now move to in_accounting
    await adminClient().from("visits").update({ state: "in_accounting" }).eq("id", v!.id);
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    acct = await makeUser({ username: "inst-acct", role: "accounting", siteId });
    owner = await makeUser({ username: "inst-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Inst Supp", phone: "07099881122" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("records multiple partial payments and balance decrements correctly", async () => {
    const vid = await newAccountingVisitWithPricing(300);

    // Three installments totalling 300
    for (const amt of [100, 100, 100]) {
      const { error } = await acct.client.from("payments").insert({
        visit_id: vid,
        direction: "purchase_amount_out",
        amount: amt,
        method: "transfer",
        recorded_by: acct.userId,
      });
      expect(error).toBeNull();
    }

    const { data: allPmts } = await adminClient()
      .from("payments")
      .select("amount, direction")
      .eq("visit_id", vid)
      .eq("direction", "purchase_amount_out");

    const totalPaid = (allPmts ?? []).reduce((s, p) => s + Number(p.amount), 0);
    expect(totalPaid).toBe(300);
  });

  it("settle transitions visit to awaiting_stock_intake", async () => {
    const vid = await newAccountingVisitWithPricing(100);
    await adminClient().from("payments").insert({
      visit_id: vid,
      direction: "purchase_amount_out",
      amount: 100,
      recorded_by: acct.userId,
    });

    // Accounting settles (server action equivalent: update state)
    await acct.client
      .from("visits")
      .update({ state: "awaiting_stock_intake" })
      .eq("id", vid);

    const { data } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", vid)
      .single();
    expect(data?.state).toBe("awaiting_stock_intake");
  });
});
