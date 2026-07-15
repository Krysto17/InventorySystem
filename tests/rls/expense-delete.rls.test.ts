import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A site manager (own site), owner, or general manager may delete an expense —
// but only before it is paid.
describe("expense delete (before payment)", () => {
  let siteId: string, otherSite: string;
  let owner: TestUser, mgr: TestUser, mgrOther: TestUser, inv: TestUser, acct: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    owner = await makeUser({ username: "ed-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "ed-mgr", role: "manager", siteId });
    mgrOther = await makeUser({ username: "ed-mgr2", role: "manager", siteId: otherSite });
    inv = await makeUser({ username: "ed-inv", role: "inventory", siteId });
    acct = await makeUser({ username: "ed-acct", role: "accounting", siteId });
  });

  async function expense(status = "pending") {
    const { data } = await adminClient().from("consumables").insert({
      site_id: siteId, name: "Diesel", category: "fuel_lubricants", amount_naira: 1000,
      entry_date: new Date().toISOString().slice(0, 10), recorded_by: inv.userId,
      approval_status: status,
      ...(status !== "pending" ? { approved_by: owner.userId, approved_at: new Date().toISOString() } : {}),
      ...(status === "paid" ? { paid_by: acct.userId, paid_at: new Date().toISOString() } : {}),
    }).select("id").single();
    return data!.id as string;
  }
  async function exists(id: string) {
    const { data } = await adminClient().from("consumables").select("id").eq("id", id).maybeSingle();
    return data != null;
  }

  it("the site manager deletes an unpaid (pending) expense", async () => {
    const id = await expense("pending");
    const { error } = await mgr.client.from("consumables").delete().eq("id", id);
    expect(error).toBeNull();
    expect(await exists(id)).toBe(false);
  });

  it("the site manager deletes an approved-but-unpaid expense", async () => {
    const id = await expense("approved");
    await mgr.client.from("consumables").delete().eq("id", id);
    expect(await exists(id)).toBe(false);
  });

  it("a paid expense cannot be deleted", async () => {
    const id = await expense("paid");
    await mgr.client.from("consumables").delete().eq("id", id);
    expect(await exists(id)).toBe(true);
  });

  it("a manager on another site cannot delete it", async () => {
    const id = await expense("pending");
    await mgrOther.client.from("consumables").delete().eq("id", id);
    expect(await exists(id)).toBe(true);
  });

  it("inventory cannot delete an expense", async () => {
    const id = await expense("pending");
    await inv.client.from("consumables").delete().eq("id", id);
    expect(await exists(id)).toBe(true);
  });
});
