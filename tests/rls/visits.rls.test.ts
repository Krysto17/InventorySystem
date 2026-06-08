import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("visits RLS", () => {
  let siteAId: string, siteBId: string;
  let procA: TestUser, procB: TestUser, recvA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    procA = await makeUser({ username: "v-proc-a", role: "processing", siteId: siteAId });
    procB = await makeUser({ username: "v-proc-b", role: "processing", siteId: siteBId });
    recvA = await makeUser({ username: "v-recv-a", role: "receiving", siteId: siteAId });
    owner = await makeUser({ username: "v-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "V Supplier", phone: "07011110000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient()
      .from("material_types")
      .select("id")
      .limit(1)
      .single();
    materialTypeId = m!.id as string;
  });

  // Visits now start directly at in_processing — there is no gate stage.
  async function insertVisitAs(user: TestUser, siteId: string) {
    return user.client.from("visits").insert({
      site_id: siteId,
      supplier_id: supplierId,
      declared_material_type_id: materialTypeId,
      entry_path: "unprocessed",
      state: "in_processing",
      created_by: user.userId,
    }).select("id").single();
  }

  it("processing can insert a visit at own site", async () => {
    const { error } = await insertVisitAs(procA, siteAId);
    expect(error).toBeNull();
  });

  it("processing cannot insert a visit at another site", async () => {
    const { error } = await insertVisitAs(procA, siteBId);
    expect(error).not.toBeNull();
  });

  it("non-processing role (receiving) cannot insert a visit", async () => {
    const { error } = await insertVisitAs(recvA, siteAId);
    expect(error).not.toBeNull();
  });

  it("processing at site A does NOT see site B visits", async () => {
    await insertVisitAs(procB, siteBId);
    const { data } = await procA.client.from("visits").select("id").eq("site_id", siteBId);
    expect(data?.length).toBe(0);
  });

  it("owner sees visits across all sites", async () => {
    const { data } = await owner.client.from("visits").select("id, site_id");
    expect(data?.length).toBeGreaterThan(0);
  });
});
