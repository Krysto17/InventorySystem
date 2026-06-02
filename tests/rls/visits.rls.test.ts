import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("visits RLS", () => {
  let siteAId: string, siteBId: string;
  let gateA: TestUser, gateB: TestUser, procA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    gateA = await makeUser({ username: "v-gate-a", role: "gate", siteId: siteAId });
    gateB = await makeUser({ username: "v-gate-b", role: "gate", siteId: siteBId });
    procA = await makeUser({ username: "v-proc-a", role: "processing", siteId: siteAId });
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

  async function insertVisitAs(user: TestUser, siteId: string) {
    return user.client.from("visits").insert({
      site_id: siteId,
      supplier_id: supplierId,
      declared_material_type_id: materialTypeId,
      entry_path: "unprocessed",
      state: "at_gate_in",
      created_by: user.userId,
    }).select("id").single();
  }

  it("gate can insert a visit at own site", async () => {
    const { error } = await insertVisitAs(gateA, siteAId);
    expect(error).toBeNull();
  });

  it("gate cannot insert a visit at another site", async () => {
    const { error } = await insertVisitAs(gateA, siteBId);
    expect(error).not.toBeNull();
  });

  it("processing role cannot insert a visit", async () => {
    const { error } = await insertVisitAs(procA, siteAId);
    expect(error).not.toBeNull();
  });

  it("gate at site A does NOT see site B visits", async () => {
    await insertVisitAs(gateB, siteBId);
    const { data } = await gateA.client.from("visits").select("id").eq("site_id", siteBId);
    expect(data?.length).toBe(0);
  });

  it("owner sees visits across all sites", async () => {
    const { data } = await owner.client.from("visits").select("id, site_id");
    expect(data?.length).toBeGreaterThan(0);
  });
});
