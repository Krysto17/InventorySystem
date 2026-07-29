import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// One customer collects an advance for a group; the DEBT is apportioned so each
// member carries their own share and the parts always add back to the total.
describe("advance shared across suppliers", () => {
  let siteId: string;
  let owner: TestUser, mgr: TestUser, acct: TestUser;
  let collector: string, mate1: string, mate2: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "as-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "as-mgr", role: "manager", siteId });
    acct = await makeUser({ username: "as-acct", role: "accounting", siteId });
    const mk = async (n: string) =>
      (await adminClient().from("suppliers").insert({ name: `${n} ${Date.now()}-${Math.random()}` }).select("id").single()).data!.id as string;
    collector = await mk("Collector");
    mate1 = await mk("Mate One");
    mate2 = await mk("Mate Two");
  });

  const debt = async (id: string) =>
    Number((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: id })).data ?? 0);

  async function paidAdvance(amount: number) {
    const { data } = await adminClient().from("advances").insert({
      supplier_id: collector, site_id: siteId, purpose: "Group float", amount_naira: amount,
      approval_status: "paid", recorded_by: mgr.userId,
    }).select("id").single();
    return data!.id as string;
  }

  it("without shares the collector carries the whole advance", async () => {
    await paidAdvance(100000);
    expect(await debt(collector)).toBe(100000);
    expect(await debt(mate1)).toBe(0);
  });

  it("apportioning moves each share off the collector onto the sharer", async () => {
    const before = await debt(collector);
    const adv = await paidAdvance(100000);

    expect((await mgr.client.from("advance_shares").insert({
      advance_id: adv, supplier_id: mate1, amount: 60000, created_by: mgr.userId,
    })).error).toBeNull();
    expect((await mgr.client.from("advance_shares").insert({
      advance_id: adv, supplier_id: mate2, amount: 30000, created_by: mgr.userId,
    })).error).toBeNull();

    // Collector keeps the unapportioned remainder (100k − 90k = 10k).
    expect(await debt(collector)).toBe(before + 10000);
    expect(await debt(mate1)).toBe(60000);
    expect(await debt(mate2)).toBe(30000);
    // The parts still add back to the advance.
    expect(10000 + 60000 + 30000).toBe(100000);
  });

  it("shares can never exceed the advance", async () => {
    const adv = await paidAdvance(50000);
    await mgr.client.from("advance_shares").insert({ advance_id: adv, supplier_id: mate1, amount: 40000, created_by: mgr.userId });
    const { error } = await mgr.client.from("advance_shares").insert({
      advance_id: adv, supplier_id: mate2, amount: 15000, created_by: mgr.userId,
    });
    expect(error).not.toBeNull();
  });

  it("the collector cannot be given a share (they keep the remainder)", async () => {
    const adv = await paidAdvance(20000);
    const { error } = await mgr.client.from("advance_shares").insert({
      advance_id: adv, supplier_id: collector, amount: 5000, created_by: mgr.userId,
    });
    expect(error).not.toBeNull();
  });

  it("removing a share returns that debt to the collector", async () => {
    const adv = await paidAdvance(80000);
    await mgr.client.from("advance_shares").insert({ advance_id: adv, supplier_id: mate1, amount: 50000, created_by: mgr.userId });
    const withShare = await debt(collector);
    const mateWith = await debt(mate1);

    await mgr.client.from("advance_shares").delete().eq("advance_id", adv).eq("supplier_id", mate1);
    expect(await debt(collector)).toBe(withShare + 50000);
    expect(await debt(mate1)).toBe(mateWith - 50000);
  });

  it("a sharer's own recovery only reduces their own balance", async () => {
    const adv = await paidAdvance(40000);
    await mgr.client.from("advance_shares").insert({ advance_id: adv, supplier_id: mate2, amount: 40000, created_by: mgr.userId });
    const collectorBefore = await debt(collector);
    const mateBefore = await debt(mate2);

    await mgr.client.from("advance_deductions").insert({
      supplier_id: mate2, site_id: siteId, amount: 10000, kind: "advance", recorded_by: mgr.userId,
    });
    expect(await debt(mate2)).toBe(mateBefore - 10000);
    expect(await debt(collector)).toBe(collectorBefore);
  });

  it("the accountant can read the apportionment but not change it", async () => {
    const adv = await paidAdvance(10000);
    await mgr.client.from("advance_shares").insert({ advance_id: adv, supplier_id: mate1, amount: 4000, created_by: mgr.userId });
    const { data } = await acct.client.from("advance_shares").select("amount").eq("advance_id", adv);
    expect(data!.length).toBe(1);
    const { error } = await acct.client.from("advance_shares").insert({
      advance_id: adv, supplier_id: mate2, amount: 1000, created_by: acct.userId,
    });
    expect(error).not.toBeNull();
  });
});
