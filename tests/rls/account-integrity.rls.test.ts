import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Account details always travel as a complete set (name + 10-digit number +
// bank), and a manager may edit/delete an advance or expense only before payment.
describe("account trio + edit/delete before payment", () => {
  let siteId: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, inv: TestUser, acct: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "ai-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "ai-mgr", role: "manager", siteId });
    inv = await makeUser({ username: "ai-inv", role: "inventory", siteId });
    acct = await makeUser({ username: "ai-acct", role: "accounting", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `AI ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
  });

  const adv = (extra: Record<string, unknown>) => adminClient().from("advances").insert({
    supplier_id: supplierId, site_id: siteId, purpose: "Float", amount_naira: 1000, recorded_by: mgr.userId, ...extra,
  }).select("id").single();

  // ── Account trio ───────────────────────────────────────────────────────────
  it("rejects a partial account (name without number/bank)", async () => {
    const { error } = await adv({ account_name: "John Doe" });
    expect(error).not.toBeNull();
  });
  it("rejects a non-10-digit account number", async () => {
    const { error } = await adv({ account_name: "John Doe", account_number: "123", bank_name: "GTB" });
    expect(error).not.toBeNull();
  });
  it("accepts a complete account", async () => {
    const { error } = await adv({ account_name: "John Doe", account_number: "0123456789", bank_name: "GTB" });
    expect(error).toBeNull();
  });
  it("accepts no account details at all", async () => {
    const { error } = await adv({});
    expect(error).toBeNull();
  });
  it("a supplier can be renamed without touching its (complete) account", async () => {
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `AI2 ${Date.now()}`, account_name: "A", account_number: "0000000001", bank_name: "B" })
      .select("id").single();
    const { error } = await adminClient().from("suppliers").update({ name: "Renamed" }).eq("id", s!.id);
    expect(error).toBeNull();
  });
  it("rejects updating a supplier account to a partial set", async () => {
    const { error } = await mgr.client.from("suppliers").update({ account_name: "X", account_number: null, bank_name: null }).eq("id", supplierId);
    expect(error).not.toBeNull();
  });

  // ── Advance edit/delete before payment ──────────────────────────────────────
  it("manager edits an approved (unpaid) advance", async () => {
    const { data } = await adv({ approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString() });
    const { error } = await mgr.client.from("advances").update({ purpose: "Fixed" }).eq("id", data!.id);
    expect(error).toBeNull();
  });
  it("a paid advance cannot be edited or deleted by the manager", async () => {
    const { data } = await adv({
      approval_status: "paid", approved_by: owner.userId, approved_at: new Date().toISOString(),
      paid_by: acct.userId, paid_at: new Date().toISOString(),
    });
    const edit = await mgr.client.from("advances").update({ purpose: "nope" }).eq("id", data!.id);
    expect(edit.error).not.toBeNull();
    await mgr.client.from("advances").delete().eq("id", data!.id);
    const { data: still } = await adminClient().from("advances").select("id").eq("id", data!.id).maybeSingle();
    expect(still).not.toBeNull();
  });
  it("manager deletes an approved (unpaid) advance", async () => {
    const { data } = await adv({ approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString() });
    await mgr.client.from("advances").delete().eq("id", data!.id);
    const { data: gone } = await adminClient().from("advances").select("id").eq("id", data!.id).maybeSingle();
    expect(gone).toBeNull();
  });

  // ── Expense edit before payment ─────────────────────────────────────────────
  it("manager edits an unpaid expense but not a paid one", async () => {
    const mk = (status: string) => adminClient().from("consumables").insert({
      site_id: siteId, name: "Diesel", category: "fuel_lubricants", amount_naira: 500,
      entry_date: new Date().toISOString().slice(0, 10), recorded_by: inv.userId, approval_status: status,
      ...(status !== "pending" ? { approved_by: owner.userId, approved_at: new Date().toISOString() } : {}),
      ...(status === "paid" ? { paid_by: acct.userId, paid_at: new Date().toISOString() } : {}),
    }).select("id").single();

    const { data: unpaid } = await mk("approved");
    expect((await mgr.client.from("consumables").update({ name: "Diesel v2" }).eq("id", unpaid!.id)).error).toBeNull();

    const { data: paid } = await mk("paid");
    expect((await mgr.client.from("consumables").update({ name: "nope" }).eq("id", paid!.id)).error).not.toBeNull();
  });
});
