import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The manager (and owner) can mark an advance or expense paid — not only the
// accountant. A held item must be released first; inventory still cannot.
describe("manager marks an advance / expense paid", () => {
  let siteId: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, inv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "mp-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "mp-mgr", role: "manager", siteId });
    inv = await makeUser({ username: "mp-inv", role: "inventory", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `MP ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
  });

  const approvedAdvance = () => adminClient().from("advances").insert({
    supplier_id: supplierId, site_id: siteId, purpose: "Float", amount_naira: 1000,
    approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(), recorded_by: mgr.userId,
  }).select("id").single();
  const approvedExpense = () => adminClient().from("consumables").insert({
    site_id: siteId, name: "Diesel", category: "fuel_lubricants", amount_naira: 800,
    entry_date: new Date().toISOString().slice(0, 10), recorded_by: inv.userId,
    approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
  }).select("id").single();

  it("manager marks an approved advance paid (stamps paid_by)", async () => {
    const { data } = await approvedAdvance();
    const { error } = await mgr.client.from("advances").update({ approval_status: "paid" }).eq("id", data!.id);
    expect(error).toBeNull();
    const row = (await adminClient().from("advances").select("approval_status, paid_by").eq("id", data!.id).single()).data!;
    expect(row.approval_status).toBe("paid");
    expect(row.paid_by).toBe(mgr.userId);
  });

  it("manager marks an approved expense paid", async () => {
    const { data } = await approvedExpense();
    const { error } = await mgr.client.from("consumables").update({ approval_status: "paid" }).eq("id", data!.id);
    expect(error).toBeNull();
    expect((await adminClient().from("consumables").select("approval_status").eq("id", data!.id).single()).data!.approval_status).toBe("paid");
  });

  it("a held advance cannot be paid until released", async () => {
    const { data } = await approvedAdvance();
    await owner.client.rpc("hold_advance", { p_id: data!.id });
    const { error } = await mgr.client.from("advances").update({ approval_status: "paid" }).eq("id", data!.id);
    expect(error).not.toBeNull();
  });

  it("inventory cannot mark an expense paid", async () => {
    const { data } = await approvedExpense();
    const { error } = await inv.client.from("consumables").update({ approval_status: "paid" }).eq("id", data!.id);
    expect(error).not.toBeNull();
  });
});
