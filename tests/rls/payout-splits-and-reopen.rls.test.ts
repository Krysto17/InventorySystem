import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A: the manager plans a payout split per account; the accountant reads it.
// B: processing/receiving delete their own in-stage visit.
// C: receiving reopens a submitted batch to add/fix lines and re-send to QC.
describe("payout splits, visit delete, receiving reopen", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, acct: TestUser, recv: TestUser, proc: TestUser, qc: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "ps-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "ps-mgr", role: "manager", siteId });
    acct = await makeUser({ username: "ps-acct", role: "accounting", siteId });
    recv = await makeUser({ username: "ps-recv", role: "receiving", siteId });
    proc = await makeUser({ username: "ps-proc", role: "processing", siteId });
    qc = await makeUser({ username: "ps-qc", role: "qc", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `PS ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  const visit = async (state: string, entry = "processed") => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: entry, state, created_by: recv.userId,
    }).select("id").single();
    return data!.id as string;
  };
  const exists = async (id: string) =>
    (await adminClient().from("visits").select("id").eq("id", id).maybeSingle()).data != null;

  // ── A. payout splits ──────────────────────────────────────────────────────
  // Splits hang off the VISIT so the manager can plan before owner approval.
  async function settlement(net = 10000) {
    const v = await visit("in_accounting");
    await adminClient().from("batch_settlements").insert({
      visit_id: v, site_id: siteId, materials_total: net, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: net, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    });
    return v;
  }
  // A priced batch still at pricing — no settlement exists yet.
  async function pricedVisit(net = 10000) {
    const v = await visit("pricing");
    await adminClient().from("visit_materials").insert({
      visit_id: v, material_type_id: monazite, weight_kg: 100, unit_price: net / 100,
      requires_analysis: false, recorded_by: recv.userId,
    });
    return v;
  }

  it("manager plans a split across two accounts; accountant can read it", async () => {
    const sid = await settlement(10000);
    const a = await mgr.client.from("settlement_payout_splits").insert({
      visit_id: sid, site_id: siteId, amount: 6500,
      account_name: "Musa Ahmed", account_number: "0123456789", bank_name: "GTB", created_by: mgr.userId,
    });
    expect(a.error).toBeNull();
    const b = await mgr.client.from("settlement_payout_splits").insert({
      visit_id: sid, site_id: siteId, amount: 3500,
      account_name: "Aisha Bello", account_number: "0222222222", bank_name: "UBA", created_by: mgr.userId,
    });
    expect(b.error).toBeNull();

    const { data: seen } = await acct.client.from("settlement_payout_splits")
      .select("amount, account_name, bank_name").eq("visit_id", sid).order("amount", { ascending: false });
    expect(seen!.length).toBe(2);
    expect(seen!.map((r) => Number(r.amount))).toEqual([6500, 3500]);
    expect(seen!.map((r) => r.account_name)).toEqual(["Musa Ahmed", "Aisha Bello"]);
  });

  it("the planned split can never exceed the payout", async () => {
    const sid = await settlement(5000);
    await mgr.client.from("settlement_payout_splits").insert({
      visit_id: sid, site_id: siteId, amount: 4000,
      account_name: "A One", account_number: "0111111111", bank_name: "Zenith", created_by: mgr.userId,
    });
    const { error } = await mgr.client.from("settlement_payout_splits").insert({
      visit_id: sid, site_id: siteId, amount: 1500,
      account_name: "B Two", account_number: "0333333333", bank_name: "Access", created_by: mgr.userId,
    });
    expect(error).not.toBeNull();
  });

  it("a partial account on a split is rejected", async () => {
    const sid = await settlement();
    const { error } = await mgr.client.from("settlement_payout_splits").insert({
      visit_id: sid, site_id: siteId, amount: 100, account_name: "No Bank", created_by: mgr.userId,
    } as never);
    expect(error).not.toBeNull();
  });

  it("the accountant cannot edit the plan", async () => {
    const sid = await settlement();
    const { error } = await acct.client.from("settlement_payout_splits").insert({
      visit_id: sid, site_id: siteId, amount: 100,
      account_name: "X", account_number: "0999999999", bank_name: "Y", created_by: acct.userId,
    });
    expect(error).not.toBeNull();
  });

  it("manager plans the split BEFORE owner approval (no settlement yet)", async () => {
    const v = await pricedVisit(10000);
    expect((await adminClient().from("batch_settlements").select("id").eq("visit_id", v)).data!.length).toBe(0);

    const { error } = await mgr.client.from("settlement_payout_splits").insert({
      visit_id: v, site_id: siteId, amount: 4000,
      account_name: "Early Plan", account_number: "0444444444", bank_name: "GTB", created_by: mgr.userId,
    });
    expect(error).toBeNull();

    // …and the plan survives the owner's approval (which recreates the settlement).
    await adminClient().from("visits").update({ state: "awaiting_price_approval" }).eq("id", v);
    await owner.client.rpc("approve_pricing", { p_visit_id: v });
    const { data: still } = await adminClient().from("settlement_payout_splits").select("amount").eq("visit_id", v);
    expect(still!.length).toBe(1);
    expect(Number(still![0].amount)).toBe(4000);
  });

  // ── B. delete own in-stage visit ──────────────────────────────────────────
  it("processing deletes a visit still in processing", async () => {
    const v = await visit("in_processing", "unprocessed");
    expect((await proc.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("receiving deletes a visit still in receiving", async () => {
    const v = await visit("in_receiving");
    expect((await recv.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("receiving cannot delete once it has moved to QC", async () => {
    const v = await visit("in_qc");
    expect((await recv.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("QC cannot delete a visit", async () => {
    const v = await visit("in_receiving");
    expect((await qc.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  // ── C. reopen receiving ───────────────────────────────────────────────────
  it("receiving reopens from QC, adds a line, and re-submits to QC", async () => {
    const v = await visit("in_receiving");
    await adminClient().from("visit_materials").insert({
      visit_id: v, material_type_id: monazite, weight_kg: 50, requires_analysis: true, recorded_by: recv.userId,
    });
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v });
    expect((await adminClient().from("visits").select("state").eq("id", v).single()).data!.state).toBe("in_qc");

    // Reopen → receiving can write again.
    expect((await recv.client.rpc("reopen_receiving", { p_visit_id: v })).error).toBeNull();
    expect((await adminClient().from("visits").select("state").eq("id", v).single()).data!.state).toBe("in_receiving");

    const add = await recv.client.from("visit_materials").insert({
      visit_id: v, material_type_id: monazite, weight_kg: 25, requires_analysis: true, recorded_by: recv.userId,
    });
    expect(add.error).toBeNull();

    // Back to QC for chemical analysis.
    expect((await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v })).error).toBeNull();
    expect((await adminClient().from("visits").select("state").eq("id", v).single()).data!.state).toBe("in_qc");
    expect((await adminClient().from("visit_materials").select("id").eq("visit_id", v)).data!.length).toBe(2);
  });

  it("QC cannot reopen receiving", async () => {
    const v = await visit("in_qc");
    expect((await qc.client.rpc("reopen_receiving", { p_visit_id: v })).error).not.toBeNull();
  });
});
