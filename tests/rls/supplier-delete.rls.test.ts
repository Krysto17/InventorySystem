import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A manager (or owner) may delete a supplier that has no records; the RPC
// refuses when anything references it, and denies other roles.
describe("delete_supplier", () => {
  let siteId: string, monaziteId: string;
  let mgr: TestUser, inv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = sites!.id as string;
    mgr = await makeUser({ username: "sd-mgr", role: "manager", siteId });
    inv = await makeUser({ username: "sd-inv", role: "inventory", siteId });
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  async function newSupplier(): Promise<string> {
    const { data } = await adminClient().from("suppliers").insert({ name: `SD ${Date.now()}-${Math.random()}` }).select("id").single();
    return data!.id as string;
  }

  it("manager deletes a supplier with no records", async () => {
    const id = await newSupplier();
    const { error } = await mgr.client.rpc("delete_supplier", { p_supplier_id: id });
    expect(error).toBeNull();
    const { data } = await adminClient().from("suppliers").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses to delete a supplier that has a visit", async () => {
    const id = await newSupplier();
    await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: id, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: mgr.userId,
    });
    const { error } = await mgr.client.rpc("delete_supplier", { p_supplier_id: id });
    expect(error).not.toBeNull();
    const { data } = await adminClient().from("suppliers").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(1); // still there
  });

  it("a non-manager role cannot delete a supplier", async () => {
    const id = await newSupplier();
    const { error } = await inv.client.rpc("delete_supplier", { p_supplier_id: id });
    expect(error).not.toBeNull();
    const { data } = await adminClient().from("suppliers").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(1);
  });
});
