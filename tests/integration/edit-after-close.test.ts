import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("edit-after-close: non-owner blocked, owner allowed", () => {
  let siteId: string;
  let gate: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    gate = await makeUser({ username: "eac-gate", role: "gate", siteId });
    recv = await makeUser({ username: "eac-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "eac-mgr", role: "manager", siteId });
    owner = await makeUser({ username: "eac-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "EAC Supp", phone: "07033330001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("after exited, receiving cannot edit analysis; owner can", async () => {
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
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    const { data: a } = await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 50, recorded_by: recv.userId })
      .select("id")
      .single();
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      agreement_status: "not_agreed",
      priced_by: mgr.userId,
    });
    await owner.client.from("gate_exit_authorizations").insert({
      visit_id: v!.id,
      authorized_by: owner.userId,
    });
    await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);

    // Receiving cannot edit closed visit's analysis (RLS silently rejects)
    await recv.client.from("analysis_records").update({ weight: 75 }).eq("id", a!.id);
    const { data: stillSame } = await adminClient()
      .from("analysis_records")
      .select("weight")
      .eq("id", a!.id)
      .single();
    expect(Number(stillSame?.weight)).toBe(50);

    // Owner can edit
    const { error } = await owner.client
      .from("analysis_records")
      .update({ weight: 80 })
      .eq("id", a!.id);
    expect(error).toBeNull();
    const { data: edited } = await adminClient()
      .from("analysis_records")
      .select("weight")
      .eq("id", a!.id)
      .single();
    expect(Number(edited?.weight)).toBe(80);
  });
});
