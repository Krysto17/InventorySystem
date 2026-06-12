import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 11 (C): payment lifecycle pending → approved (owner) → paid /
// partially_paid (accounting), plus rejection; legacy direct-'paid' inserts
// still work (Phase 3 behavior).
describe("payment status workflow", () => {
  let siteId: string;
  let acct: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function visitInAccounting(): Promise<string> {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "in_receiving", created_by: acct.userId,
    }).select("id").single();
    // Walk legally: the analysis insert auto-advances in_receiving → pricing,
    // then pricing → in_accounting is a legal forward edge.
    await adminClient().from("analysis_records").insert({
      visit_id: v!.id, weight: 100, grade: "A", recorded_by: acct.userId,
    });
    const { error } = await adminClient().from("visits")
      .update({ state: "in_accounting" }).eq("id", v!.id);
    if (error) throw error;
    return v!.id as string;
  }

  async function pendingPayment(visitId: string): Promise<string> {
    const { data, error } = await acct.client.from("payments").insert({
      visit_id: visitId, direction: "purchase_amount_out", amount: 10000,
      status: "pending", recorded_by: acct.userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    acct  = await makeUser({ username: "pst-acct", role: "accounting", siteId });
    mgr   = await makeUser({ username: "pst-mgr",  role: "manager",    siteId });
    owner = await makeUser({ username: "pst-owner", role: "owner",     siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "PSt Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("legacy insert defaults to status 'paid'", async () => {
    const vid = await visitInAccounting();
    const { data, error } = await acct.client.from("payments").insert({
      visit_id: vid, direction: "processing_fee_in", amount: 500, recorded_by: acct.userId,
    }).select("status").single();
    expect(error).toBeNull();
    expect(data!.status).toBe("paid");
  });

  it("accountant cannot insert a payment already 'approved'", async () => {
    const vid = await visitInAccounting();
    const { error } = await acct.client.from("payments").insert({
      visit_id: vid, direction: "purchase_amount_out", amount: 100,
      status: "approved", recorded_by: acct.userId,
    });
    expect(error).not.toBeNull();
  });

  it("full lifecycle: pending → approved (owner) → partially_paid → paid (accountant)", async () => {
    const vid = await visitInAccounting();
    const pid = await pendingPayment(vid);

    // Accountant cannot approve…
    const tryAcct = await acct.client.from("payments").update({ status: "approved" }).eq("id", pid);
    expect(tryAcct.error).not.toBeNull();

    // Owner approves.
    const ownerOk = await owner.client.from("payments").update({ status: "approved" }).eq("id", pid);
    expect(ownerOk.error).toBeNull();

    // Accountant disburses part, then completes.
    const part = await acct.client.from("payments").update({ status: "partially_paid" }).eq("id", pid);
    expect(part.error).toBeNull();
    const done = await acct.client.from("payments").update({ status: "paid" }).eq("id", pid);
    expect(done.error).toBeNull();

    const { data } = await adminClient().from("payments").select("status").eq("id", pid).single();
    expect(data!.status).toBe("paid");
  });

  it("owner can reject a pending payment; rejected is terminal", async () => {
    const vid = await visitInAccounting();
    const pid = await pendingPayment(vid);
    await owner.client.from("payments").update({ status: "rejected", status_note: "duplicate" }).eq("id", pid);
    const { data } = await adminClient().from("payments").select("status").eq("id", pid).single();
    expect(data!.status).toBe("rejected");

    const { error } = await owner.client.from("payments").update({ status: "approved" }).eq("id", pid);
    expect(error).not.toBeNull();
  });

  it("pending cannot jump straight to paid", async () => {
    const vid = await visitInAccounting();
    const pid = await pendingPayment(vid);
    const { error } = await acct.client.from("payments").update({ status: "paid" }).eq("id", pid);
    expect(error).not.toBeNull();
  });
});
