import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The manager comments on a supply; the owner and accountant can read it before
// paying. A site manager can't read another site's; the accountant is read-only.
describe("batch_comments RLS", () => {
  let siteAId: string, siteBId: string, monaziteId: string, visitId: string;
  let mgrA: TestUser, siteMgrB: TestUser, acct: TestUser, owner: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const plain = sites!.filter((s) => s.name !== "New-Site");
    siteAId = plain[0].id as string;
    siteBId = plain[1].id as string;
    const newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    mgrA = await makeUser({ username: "bc-mgra", role: "manager", siteId: siteAId });
    siteMgrB = await makeUser({ username: "bc-mgrb", role: "manager", siteId: siteBId });
    acct = await makeUser({ username: "bc-acct", role: "accounting", siteId: newSite }); // cross-site
    owner = await makeUser({ username: "bc-owner", role: "owner", siteId: null });
    recv = await makeUser({ username: "bc-recv", role: "receiving", siteId: siteAId });
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
    const { data: sup } = await adminClient().from("suppliers").insert({ name: `BC ${Date.now()}` }).select("id").single();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteAId, supplier_id: sup!.id, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    visitId = v!.id as string;
  });

  it("manager posts a comment; owner and accountant can read it", async () => {
    const { error } = await mgrA.client.from("batch_comments").insert({
      visit_id: visitId, site_id: siteAId, body: "Pay after Friday — rate reduced for moisture", author: mgrA.userId,
    });
    expect(error).toBeNull();

    const ownerRead = await owner.client.from("batch_comments").select("body").eq("visit_id", visitId);
    expect(ownerRead.data ?? []).toHaveLength(1);
    const acctRead = await acct.client.from("batch_comments").select("body").eq("visit_id", visitId);
    expect(acctRead.data ?? []).toHaveLength(1);
    expect(acctRead.data![0].body).toContain("moisture");
  });

  it("a manager at another site cannot read it", async () => {
    const { data } = await siteMgrB.client.from("batch_comments").select("id").eq("visit_id", visitId);
    expect(data ?? []).toHaveLength(0);
  });

  it("the accountant cannot post a comment (read-only)", async () => {
    const { error } = await acct.client.from("batch_comments").insert({
      visit_id: visitId, site_id: siteAId, body: "acct note", author: acct.userId,
    });
    expect(error).not.toBeNull();
  });
});
