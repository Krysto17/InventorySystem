import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Advance debt and processing (carried light bill) debt are SEPARATE balances;
// a recovery only reduces the balance matching its kind, and each is guarded
// against over-deduction independently.
describe("processing debt vs advance debt", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "pd-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "pd-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "pd-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `PD ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  const advDebt = async () => Number((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId })).data ?? 0);
  const procDebt = async () => Number((await adminClient().rpc("supplier_processing_debt", { _supplier_id: supplierId })).data ?? 0);

  it("a carried light bill lands in PROCESSING debt, not advance debt", async () => {
    const advBefore = await advDebt();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "unprocessed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("utility_charges").insert({
      visit_id: v!.id, kind: "light_bill", description: "Dressing", amount: 4000, recorded_by: recv.userId,
    });
    await mgr.client.rpc("close_dressing_only", { p_visit_id: v!.id, p_carry: true });

    expect(await procDebt()).toBe(4000);
    expect(await advDebt()).toBe(advBefore); // untouched
  });

  it("a paid advance lands in ADVANCE debt, not processing debt", async () => {
    const procBefore = await procDebt();
    await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "Float", amount_naira: 10000,
      approval_status: "paid", recorded_by: mgr.userId,
    });
    expect(await advDebt()).toBe(10000);
    expect(await procDebt()).toBe(procBefore); // untouched
  });

  it("a processing recovery reduces only the processing balance", async () => {
    const { error } = await mgr.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, amount: 1500, kind: "processing",
      notes: "Recovered from supply", recorded_by: mgr.userId,
    });
    expect(error).toBeNull();
    expect(await procDebt()).toBe(2500);
    expect(await advDebt()).toBe(10000); // untouched
  });

  it("an advance recovery reduces only the advance balance", async () => {
    const { error } = await mgr.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, amount: 4000, kind: "advance", recorded_by: mgr.userId,
    });
    expect(error).toBeNull();
    expect(await advDebt()).toBe(6000);
    expect(await procDebt()).toBe(2500); // untouched
  });

  it("cannot over-recover processing debt using the advance balance", async () => {
    // Processing debt is 2500 even though advance debt is 6000.
    const { error } = await mgr.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, amount: 3000, kind: "processing", recorded_by: mgr.userId,
    });
    expect(error).not.toBeNull();
    expect(await procDebt()).toBe(2500);
  });

  it("an off-app repayment can target the processing balance", async () => {
    const { error } = await owner.client.rpc("record_debt_repayment", {
      p_supplier_id: supplierId, p_amount: 2500, p_kind: "processing", p_note: "Cash for light bill",
    });
    expect(error).toBeNull();
    expect(await procDebt()).toBe(0);
    expect(await advDebt()).toBe(6000);
  });
});
