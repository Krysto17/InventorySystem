import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Manager-formed mixing batches: the manager submits a PENDING batch (lots stay
// in stock), the OWNER approves to remove each lot (flip to sold + 'mixed_batch'
// ledger 'out'); the weighted cost is recorded on attach.
describe("cost-price mixing batch sells stock on owner approval", () => {
  const rid = Date.now().toString(36);
  let siteAId: string, materialId: string, supplierId: string;
  let mgr: TestUser, inv: TestUser, owner: TestUser;

  async function makeLot(weight: number, cost: number) {
    const { data: lot } = await adminClient().from("stock_lots").insert({
      site_id: siteAId, material_type_id: materialId, supplier_id: supplierId,
      weight_kg: weight, cost_price_per_kg: cost, recorded_by: owner.userId,
    }).select("id").single();
    await adminClient().from("stock_movements").insert({
      site_id: siteAId, material_type_id: materialId, weight, direction: "in",
      recorded_by: owner.userId, reason: "purchase_intake",
    });
    return lot!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteAId = sites![0].id as string;
    const { data: mat } = await adminClient().from("material_types").select("id").limit(1).single();
    materialId = mat!.id as string;
    const { data: sup } = await adminClient()
      .from("suppliers").insert({ name: `CB Supplier ${rid}`, phone: "07" }).select("id").single();
    supplierId = sup!.id as string;
    mgr   = await makeUser({ username: `cb-mgr-${rid}`,   role: "manager",   siteId: siteAId });
    inv   = await makeUser({ username: `cb-inv-${rid}`,   role: "inventory", siteId: siteAId });
    owner = await makeUser({ username: `cb-owner-${rid}`, role: "owner",     siteId: null });
  });

  async function pendingBatch(lotIds: string[]) {
    const { data: run } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Mixed monazite", material_type_id: materialId,
      approval_status: "pending", created_by: mgr.userId,
    }).select("id").single();
    for (const lotId of lotIds) {
      const { error } = await mgr.client.from("cost_price_run_lots")
        .insert({ run_id: run!.id, stock_lot_id: lotId });
      expect(error).toBeNull();
    }
    return run!.id as string;
  }

  it("a pending batch leaves lots in stock and records the weighted average", async () => {
    const lot1 = await makeLot(100, 50);
    const lot2 = await makeLot(200, 80);
    const runId = await pendingBatch([lot1, lot2]);

    const { data: lots } = await adminClient().from("stock_lots").select("status").in("id", [lot1, lot2]);
    expect((lots ?? []).every((l) => l.status === "available")).toBe(true); // not sold yet

    const { data: runRow } = await adminClient()
      .from("cost_price_runs").select("avg_cost_price_per_kg, total_weight_kg").eq("id", runId).single();
    expect(Number(runRow!.total_weight_kg)).toBe(300);
    expect(Number(runRow!.avg_cost_price_per_kg)).toBe(70); // (100*50 + 200*80)/300
  });

  it("owner approval removes the lots from stock (sold + mixed_batch out); manager cannot approve", async () => {
    const lot1 = await makeLot(100, 50);
    const lot2 = await makeLot(200, 80);
    const runId = await pendingBatch([lot1, lot2]);

    // Manager cannot approve their own batch.
    const mgrTry = await mgr.client.from("cost_price_runs")
      .update({ approval_status: "approved" }).eq("id", runId);
    const { data: stillPending } = await adminClient()
      .from("cost_price_runs").select("approval_status").eq("id", runId).single();
    expect(stillPending!.approval_status).toBe("pending");
    void mgrTry;

    const { error } = await owner.client.from("cost_price_runs")
      .update({ approval_status: "approved", approved_by: owner.userId, sold: true, sold_at: new Date().toISOString() })
      .eq("id", runId);
    expect(error).toBeNull();

    const { data: lots } = await adminClient().from("stock_lots").select("status").in("id", [lot1, lot2]);
    expect((lots ?? []).every((l) => l.status === "sold")).toBe(true);

    const { data: outs } = await adminClient()
      .from("stock_movements").select("direction, reason").eq("reason", "mixed_batch").in("weight", [100, 200]);
    expect((outs ?? []).filter((o) => o.direction === "out").length).toBeGreaterThanOrEqual(2);
  });

  it("rejecting a batch leaves the lots in stock", async () => {
    const lot = await makeLot(50, 40);
    const runId = await pendingBatch([lot]);
    const { error } = await owner.client.from("cost_price_runs")
      .update({ approval_status: "rejected", approved_by: owner.userId }).eq("id", runId);
    expect(error).toBeNull();
    const { data: l } = await adminClient().from("stock_lots").select("status").eq("id", lot).single();
    expect(l!.status).toBe("available");
  });

  it("a non-sell computation (null status) leaves lots available", async () => {
    const lot = await makeLot(50, 40);
    const { data: run } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Just a calc", created_by: mgr.userId,
    }).select("id").single();
    await mgr.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot });
    const { data: l } = await adminClient().from("stock_lots").select("status").eq("id", lot).single();
    expect(l!.status).toBe("available");
  });

  it("inventory cannot create a cost-price run", async () => {
    const { error } = await inv.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "nope", approval_status: "pending", created_by: inv.userId,
    });
    expect(error).not.toBeNull();
  });
});
