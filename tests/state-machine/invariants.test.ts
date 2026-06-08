import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("state-machine invariants", () => {
  let siteId: string, proc: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "inv-proc", role: "processing", siteId });
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
    const { data: v } = await proc.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "in_receiving",
        created_by: proc.userId,
      })
      .select("id")
      .single();
    const { error } = await owner.client
      .from("visits")
      .update({ state: "pricing" })
      .eq("id", v!.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/analysis_records/);
  });

  it("no-agreement path goes pricing → exited directly (no authorization needed)", async () => {
    const { data: v } = await proc.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "in_receiving",
        created_by: proc.userId,
      })
      .select("id")
      .single();
    await owner.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 1, grade: "F", recorded_by: owner.userId });
    await owner.client.from("visits").update({ state: "pricing" }).eq("id", v!.id);

    const { error } = await owner.client
      .from("visits")
      .update({ state: "exited" })
      .eq("id", v!.id);
    expect(error).toBeNull();

    const { data: final } = await adminClient()
      .from("visits")
      .select("state, closed_at")
      .eq("id", v!.id)
      .single();
    expect(final?.state).toBe("exited");
    expect(final?.closed_at).not.toBeNull();
  });
});
