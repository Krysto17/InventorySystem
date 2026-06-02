import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("machines RLS", () => {
  let siteAId: string, siteBId: string;
  let procA: TestUser, procB: TestUser, owner: TestUser;
  let machineAId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    procA = await makeUser({ username: "mach-proc-a", role: "processing", siteId: siteAId });
    procB = await makeUser({ username: "mach-proc-b", role: "processing", siteId: siteBId });
    owner = await makeUser({ username: "mach-owner", role: "owner", siteId: null });

    const { data: machine } = await adminClient()
      .from("machines")
      .insert({ site_id: siteAId, name: "Crusher #1", charge_basis: "weight", rate: 15.0 })
      .select("id")
      .single();
    machineAId = machine!.id as string;
  });

  it("processing at site A sees site A machines", async () => {
    const { data, error } = await procA.client
      .from("machines")
      .select("id, name")
      .eq("id", machineAId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("processing at site B does NOT see site A machines", async () => {
    const { data, error } = await procB.client
      .from("machines")
      .select("id")
      .eq("id", machineAId);
    expect(error).toBeNull();
    expect(data?.length).toBe(0);
  });

  it("non-owner cannot insert a machine", async () => {
    const { error } = await procA.client
      .from("machines")
      .insert({ site_id: siteAId, name: "Sneaky", charge_basis: "bag", rate: 100 });
    expect(error).not.toBeNull();
  });

  it("owner can insert a machine at any site", async () => {
    const { error } = await owner.client
      .from("machines")
      .insert({ site_id: siteBId, name: "Mag-Separator", charge_basis: "hour", rate: 5000 });
    expect(error).toBeNull();
  });

  it("owner can see machines across all sites", async () => {
    const { data, error } = await owner.client.from("machines").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(2);
  });
});
