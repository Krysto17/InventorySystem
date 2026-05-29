import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("material_types RLS", () => {
  let siteId: string;
  let gate: TestUser, owner: TestUser;
  let controlId: string;

  beforeAll(async () => {
    // Clean up test-inserted rows and auth users from prior runs.
    await adminClient()
      .from("material_types")
      .delete()
      .in("name", ["Coltan", "Wolframite", "Test Control Row", "Delete Test Material"]);
    const admin = adminClient();
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users.users.filter(u => u.email?.startsWith("mt-"))) {
      await admin.auth.admin.deleteUser(u.id);
    }
    siteId = await firstSiteId();
    gate = await makeUser({ username: "mt-gate", role: "gate", siteId });
    owner = await makeUser({ username: "mt-owner", role: "owner", siteId: null });

    // Insert a dedicated control row with known name and active=true.
    // Targeted by ID in update/soft-delete tests to avoid ordering flakiness.
    const { data: ctrl } = await adminClient()
      .from("material_types")
      .insert({ name: "Test Control Row", active: true })
      .select("id")
      .single();
    controlId = ctrl!.id;
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
    const { error } = await gate.client
      .from("material_types")
      .update({ active: false })
      .eq("id", controlId);
    // Update silently affects 0 rows due to RLS — verify by re-reading
    const { data: after } = await adminClient()
      .from("material_types").select("active").eq("id", controlId).single();
    expect(after?.active).toBe(true);
  });

  it("owner can soft-delete (set active=false)", async () => {
    const { error } = await owner.client
      .from("material_types")
      .update({ active: false })
      .eq("id", controlId);
    expect(error).toBeNull();
    const { data: after } = await adminClient()
      .from("material_types").select("active").eq("id", controlId).single();
    expect(after?.active).toBe(false);
  });

  it("non-owner cannot DELETE; owner can DELETE", async () => {
    const { data: row } = await adminClient()
      .from("material_types")
      .insert({ name: "Delete Test Material" })
      .select("id")
      .single();

    // Non-owner attempt: silently affects 0 rows
    await gate.client.from("material_types").delete().eq("id", row!.id);
    const { data: still } = await adminClient()
      .from("material_types").select("id").eq("id", row!.id).single();
    expect(still?.id).toBe(row!.id);

    // Owner attempt: succeeds
    const { error } = await owner.client.from("material_types").delete().eq("id", row!.id);
    expect(error).toBeNull();
    const { data: gone } = await adminClient()
      .from("material_types").select("id").eq("id", row!.id);
    expect(gone?.length).toBe(0);
  });
});
