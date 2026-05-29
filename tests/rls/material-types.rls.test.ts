import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("material_types RLS", () => {
  let siteId: string;
  let gate: TestUser, owner: TestUser;

  beforeAll(async () => {
    siteId = await firstSiteId();
    gate = await makeUser({ username: "mt-gate", role: "gate", siteId });
    owner = await makeUser({ username: "mt-owner", role: "owner", siteId: null });
  });

  it("any authenticated user can read material_types", async () => {
    const { data, error } = await gate.client.from("material_types").select("id, name").limit(5);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });

  it("non-owner cannot insert material_types", async () => {
    const { error } = await gate.client.from("material_types").insert({ name: "Coltan" });
    expect(error).not.toBeNull();
  });

  it("owner can insert material_types", async () => {
    const { error } = await owner.client.from("material_types").insert({ name: "Wolframite" });
    expect(error).toBeNull();
  });

  it("non-owner cannot update material_types", async () => {
    const { data: row } = await adminClient().from("material_types").select("id").limit(1).single();
    const { error } = await gate.client
      .from("material_types")
      .update({ active: false })
      .eq("id", row!.id);
    // Update silently affects 0 rows due to RLS — verify by re-reading
    const { data: after } = await adminClient()
      .from("material_types").select("active").eq("id", row!.id).single();
    expect(after?.active).toBe(true);
  });

  it("owner can soft-delete (set active=false)", async () => {
    const { data: row } = await adminClient().from("material_types").select("id").limit(1).single();
    const { error } = await owner.client
      .from("material_types")
      .update({ active: false })
      .eq("id", row!.id);
    expect(error).toBeNull();
    const { data: after } = await adminClient()
      .from("material_types").select("active").eq("id", row!.id).single();
    expect(after?.active).toBe(false);
  });
});
