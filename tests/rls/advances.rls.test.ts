import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("advances RLS", () => {
  let siteAId: string, siteBId: string;
  let mgrA: TestUser, acctA: TestUser, invA: TestUser, mgrB: TestUser, gm: TestUser, owner: TestUser;
  let supplierId: string;

  async function insertPending(siteId: string, userId: string) {
    const { data, error } = await adminClient()
      .from("advances")
      .insert({
        supplier_id: supplierId,
        site_id: siteId,
        purpose: "Diesel float",
        amount_naira: 50000,
        recorded_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    // siteA/siteB are plain (non-New-Site) sites so their managers are site-scoped;
    // the general manager (New-Site) is the cross-site read/write authority.
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const plain = sites!.filter((s) => s.name !== "New-Site");
    siteAId = plain[0].id as string;
    siteBId = plain[1].id as string;
    const newSiteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    mgrA  = await makeUser({ username: "adv-mgr-a",  role: "manager",    siteId: siteAId });
    acctA = await makeUser({ username: "adv-acct-a", role: "accounting", siteId: siteAId });
    invA  = await makeUser({ username: "adv-inv-a",  role: "inventory",  siteId: siteAId });
    mgrB  = await makeUser({ username: "adv-mgr-b",  role: "manager",    siteId: siteBId });
    gm    = await makeUser({ username: "adv-gm",     role: "manager",    siteId: newSiteId });
    owner = await makeUser({ username: "adv-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Advance Supplier", phone: "0800" })
      .select("id")
      .single();
    supplierId = s!.id as string;
  });

  it("manager at site A can record an advance for site A", async () => {
    const { error } = await mgrA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Cash advance",
      amount_naira: 25000,
      recorded_by: mgrA.userId,
    });
    expect(error).toBeNull();
  });

  it("accountant at site A can also record an advance", async () => {
    const { error } = await acctA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Top-up",
      amount_naira: 10000,
      recorded_by: acctA.userId,
    });
    expect(error).toBeNull();
  });

  it("inventory role cannot record an advance", async () => {
    const { error } = await invA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Should fail",
      amount_naira: 5000,
      recorded_by: invA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("a site manager at site B cannot record an advance for site A", async () => {
    const { error } = await mgrB.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Cross-site hack",
      amount_naira: 5000,
      recorded_by: mgrB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("the general manager (New-Site) CAN record an advance cross-site", async () => {
    const { error } = await gm.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "GM cross-site advance",
      amount_naira: 5000,
      recorded_by: gm.userId,
    });
    expect(error).toBeNull();
  });

  it("the general manager reads other-site advances; a site manager cannot", async () => {
    const id = await insertPending(siteAId, mgrA.userId);
    const gmRead = await gm.client.from("advances").select("id").eq("id", id);
    expect(gmRead.data ?? []).toHaveLength(1);
    const siteMgrRead = await mgrB.client.from("advances").select("id").eq("id", id);
    expect(siteMgrRead.data ?? []).toHaveLength(0);
  });

  it("inventory role still cannot read other-site advances", async () => {
    const id = await insertPending(siteBId, mgrB.userId);
    const { data } = await invA.client.from("advances").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("owner approves an advance (approved_at stamped); accountant cannot approve", async () => {
    const id = await insertPending(siteAId, mgrA.userId);
    // The accountant may no longer approve — only the owner does (accountant pays).
    const acctTry = await acctA.client
      .from("advances")
      .update({ approval_status: "approved" })
      .eq("id", id);
    expect(acctTry.error).not.toBeNull();

    const { error } = await owner.client
      .from("advances")
      .update({ approval_status: "approved" })
      .eq("id", id);
    expect(error).toBeNull();
    const { data } = await adminClient()
      .from("advances")
      .select("approval_status, approved_at")
      .eq("id", id)
      .single();
    expect(data!.approval_status).toBe("approved");
    expect(data!.approved_at).not.toBeNull();
  });

  it("owner can read advances across sites", async () => {
    const id = await insertPending(siteBId, mgrB.userId);
    const { data } = await owner.client.from("advances").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(1);
  });

  it("amount must be positive", async () => {
    const { error } = await mgrA.client.from("advances").insert({
      supplier_id: supplierId,
      site_id: siteAId,
      purpose: "Bad amount",
      amount_naira: -100,
      recorded_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });
});
