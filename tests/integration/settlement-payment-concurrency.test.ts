import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * A payout must not be paid twice because two requests arrived together.
 *
 * record_settlement_payment read the settlement, summed what had been paid,
 * checked the remainder and inserted — without holding the row. Under READ
 * COMMITTED none of the concurrent callers sees an insert the others have not
 * committed, so they all read the same total, all pass the balance check, and
 * all insert. Reproduced before 0151 on a ₦50,000 settlement: five concurrent
 * full-balance payments, up to five accepted, ₦250,000 recorded, in 4/4 trials.
 *
 * The money leaves the safe before the books are wrong, so this is not a
 * reporting bug — it is cash out of the door. 0151 takes `for update` on the
 * settlement; these tests fail loudly if that lock is ever dropped.
 *
 * Note the shape: asserting "the RPC returned an error" is not enough, because
 * the danger is the ROW TOTAL. Every assertion here reads the ledger back.
 */
describe("settlement payment concurrency", () => {
  let inv: TestUser, acct: TestUser;
  let siteId: string, materialTypeId: string;

  const NET = 50_000;

  async function approvedSettlement(net = NET) {
    const { data: sup } = await adminClient().from("suppliers")
      .insert({ name: `CONC ${Date.now()}-${Math.random()}` }).select("id").single();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: sup!.id, declared_material_type_id: materialTypeId,
      entry_path: "processed", state: "in_accounting", created_by: inv.userId,
    }).select("id").single();
    const { data: st, error } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: net, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: net,
      submitted_by: inv.userId, status: "approved",
    }).select("id").single();
    expect(error, `settlement fixture: ${error?.message}`).toBeNull();
    return st!.id as string;
  }

  const paidTotal = async (id: string) => {
    const { data } = await adminClient().from("settlement_payments").select("amount").eq("settlement_id", id);
    return (data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  };

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    inv = await makeUser({ username: `conc-inv-${Date.now()}`, role: "inventory", siteId });
    acct = await makeUser({ username: `conc-acct-${Date.now()}`, role: "accounting", siteId });
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = mt!.id as string;
  });

  it("five simultaneous full-balance payments settle it exactly once", async () => {
    const id = await approvedSettlement();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        inv.client.rpc("record_settlement_payment", {
          p_settlement_id: id, p_amount: NET, p_method: "cash",
        })),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    // The assertion that matters: the ledger, not the return values.
    expect(await paidTotal(id)).toBe(NET);
  });

  it("two roles paying the same settlement at once cannot both succeed", async () => {
    // The realistic shape: inventory counts cash at the desk while accounting
    // records a transfer for the same payout.
    const id = await approvedSettlement();
    const [a, b] = await Promise.all([
      inv.client.rpc("record_settlement_payment", { p_settlement_id: id, p_amount: NET, p_method: "cash" }),
      acct.client.rpc("record_settlement_payment", { p_settlement_id: id, p_amount: NET, p_method: "transfer" }),
    ]);
    expect([a.error, b.error].filter(Boolean)).toHaveLength(1);
    expect(await paidTotal(id)).toBe(NET);
  });

  it("concurrent PART payments all land, and never exceed the balance", async () => {
    // The lock must serialise legitimate work, not refuse it.
    const id = await approvedSettlement();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        inv.client.rpc("record_settlement_payment", {
          p_settlement_id: id, p_amount: NET / 10, p_method: "cash",
        })),
    );
    expect(await paidTotal(id)).toBe(NET);
    const { data: st } = await adminClient()
      .from("batch_settlements").select("status").eq("id", id).single();
    expect(st!.status).toBe("paid");
  });

  it("an over-payment attempt after the balance is cleared is refused", async () => {
    const id = await approvedSettlement();
    expect((await inv.client.rpc("record_settlement_payment",
      { p_settlement_id: id, p_amount: NET, p_method: "cash" })).error).toBeNull();
    const { error } = await inv.client.rpc("record_settlement_payment",
      { p_settlement_id: id, p_amount: 1, p_method: "cash" });
    expect(error).not.toBeNull();
    expect(await paidTotal(id)).toBe(NET);
  });
});
