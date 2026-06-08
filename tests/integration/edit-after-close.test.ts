import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("edit-after-close: non-owner blocked, owner allowed", () => {
  let siteId: string;
  let proc: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "eac-proc", role: "processing", siteId });
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
    const { data: a } = await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 50, recorded_by: recv.userId })
      .select("id")
      .single();
    // Manager "no agreement" → visit transitions straight to exited.
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      agreement_status: "not_agreed",
      priced_by: mgr.userId,
    });

    const { data: closed } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(closed?.state).toBe("exited");

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
