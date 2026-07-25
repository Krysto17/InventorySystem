import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A supply payout can be split across several accounts: one payment row per
// account, each recording where it went; the settlement closes when the total
// reaches the net balance.
describe("split a payout across accounts", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "sp-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "sp-acct", role: "accounting", siteId });
    recv = await makeUser({ username: "sp-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `SP ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function approvedSettlement(net = 10000) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 100, unit_price: net / 100,
      requires_analysis: false, recorded_by: recv.userId,
    });
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: net, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: net, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return bs!.id as string;
  }

  it("splits one payout across two accounts and closes the settlement", async () => {
    const id = await approvedSettlement(10000);

    const p1 = await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 6000, p_method: "transfer",
      p_account_name: "Musa Ahmed", p_account_number: "0123456789", p_bank_name: "GTB",
    });
    expect(p1.error).toBeNull();
    expect((await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!.status).toBe("partially_paid");

    const p2 = await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 4000, p_method: "transfer",
      p_account_name: "Aisha Bello", p_account_number: "0222222222", p_bank_name: "UBA",
    });
    expect(p2.error).toBeNull();
    expect((await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!.status).toBe("paid");

    const { data: rows } = await adminClient().from("settlement_payments")
      .select("amount, account_name, account_number, bank_name").eq("settlement_id", id).order("amount", { ascending: false });
    expect(rows!.length).toBe(2);
    expect(rows!.map((r) => r.account_name)).toEqual(["Musa Ahmed", "Aisha Bello"]);
    expect(rows!.map((r) => Number(r.amount))).toEqual([6000, 4000]);
  });

  it("the split total still cannot exceed the net balance", async () => {
    const id = await approvedSettlement(5000);
    await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 3000, p_method: "cash",
      p_account_name: "A One", p_account_number: "0111111111", p_bank_name: "Zenith",
    });
    const over = await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 2500, p_method: "cash",
      p_account_name: "B Two", p_account_number: "0333333333", p_bank_name: "Access",
    });
    expect(over.error).not.toBeNull();
  });

  it("a partial account (no bank/number) is rejected", async () => {
    const id = await approvedSettlement(2000);
    const { error } = await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 1000, p_method: "transfer", p_account_name: "Only Name",
    });
    expect(error).not.toBeNull();
  });

  it("account details stay optional (pays to the supplier default)", async () => {
    const id = await approvedSettlement(1500);
    const { error } = await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 1500, p_method: "cash",
    });
    expect(error).toBeNull();
    expect((await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!.status).toBe("paid");
  });
});
