import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("state-machine invariants", () => {
  let siteId: string, gate: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    gate = await makeUser({ username: "inv-gate", role: "gate", siteId });
    owner = await makeUser({ username: "inv-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "INV Supp", phone: "07055550001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("cannot enter pricing without analysis_records", async () => {
    const { data: v } = await gate.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "at_gate_in",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    await owner.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    const { error } = await owner.client
      .from("visits")
      .update({ state: "pricing" })
      .eq("id", v!.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/analysis_records/);
  });

  it("cannot enter exited without gate_exit_authorizations row", async () => {
    const { data: v } = await owner.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "awaiting_gate_exit",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    const { error } = await gate.client
      .from("visits")
      .update({ state: "exited" })
      .eq("id", v!.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/gate_exit_authorizations/);
  });
});
