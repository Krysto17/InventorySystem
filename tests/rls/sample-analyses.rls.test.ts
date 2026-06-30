import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Standalone QC sample analyses: QC records (own site), owner + general manager
// read all and price; site managers read own site but can't price; other-site
// QC can't read.
describe("sample_analyses RLS", () => {
  let newSiteId: string, otherSiteId: string;
  let qc: TestUser, qc2: TestUser, owner: TestUser, gm: TestUser, mgr: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSiteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    otherSiteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    qc = await makeUser({ username: "smp-qc", role: "qc", siteId: otherSiteId });
    qc2 = await makeUser({ username: "smp-qc2", role: "qc", siteId: newSiteId });
    owner = await makeUser({ username: "smp-owner", role: "owner", siteId: null });
    gm = await makeUser({ username: "smp-gm", role: "manager", siteId: newSiteId }); // general manager
    mgr = await makeUser({ username: "smp-mgr", role: "manager", siteId: otherSiteId }); // site manager
  });

  const addSample = (u: TestUser, name: string) =>
    u.client.from("sample_analyses")
      .insert({ site_id: otherSiteId, supplier_name: name, result: "Sn 40%", recorded_by: u.userId })
      .select("id, price").single();

  it("QC records a sample (unpriced) and the owner prices it", async () => {
    const { data: s, error } = await addSample(qc, "Walk-in A");
    expect(error).toBeNull();
    expect(s!.price).toBeNull();

    const { error: pe } = await owner.client
      .from("sample_analyses").update({ price: 5000, priced_by: owner.userId }).eq("id", s!.id);
    expect(pe).toBeNull();
    const { data } = await adminClient().from("sample_analyses").select("price").eq("id", s!.id).single();
    expect(Number(data!.price)).toBe(5000);
  });

  it("the general manager reads cross-site and can price", async () => {
    const { data: s } = await addSample(qc, "Walk-in B");
    const read = await gm.client.from("sample_analyses").select("id").eq("id", s!.id);
    expect(read.data ?? []).toHaveLength(1);
    const { error } = await gm.client
      .from("sample_analyses").update({ price: 1200, priced_by: gm.userId }).eq("id", s!.id);
    expect(error).toBeNull();
    const { data } = await adminClient().from("sample_analyses").select("price").eq("id", s!.id).single();
    expect(Number(data!.price)).toBe(1200);
  });

  it("a site manager reads own-site samples but cannot set a price", async () => {
    const { data: s } = await addSample(qc, "Walk-in C");
    const read = await mgr.client.from("sample_analyses").select("id").eq("id", s!.id);
    expect(read.data ?? []).toHaveLength(1); // own site read OK
    await mgr.client.from("sample_analyses").update({ price: 999 }).eq("id", s!.id); // RLS blocks
    const { data } = await adminClient().from("sample_analyses").select("price").eq("id", s!.id).single();
    expect(data!.price).toBeNull(); // unchanged
  });

  it("a QC at another site cannot read the sample", async () => {
    const { data: s } = await addSample(qc, "Walk-in D");
    const read = await qc2.client.from("sample_analyses").select("id").eq("id", s!.id);
    expect(read.data ?? []).toHaveLength(0);
  });
});
