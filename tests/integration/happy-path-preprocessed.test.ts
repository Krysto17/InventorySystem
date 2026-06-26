import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("happy path: processed → agreed → in_accounting (no processing stage)", () => {
  let siteId: string;
  let proc: TestUser, recv: TestUser, mgr: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "hpp-proc", role: "processing", siteId });
    recv = await makeUser({ username: "hpp-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "hpp-mgr", role: "manager", siteId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "HPP Supp", phone: "07099990000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("skips processing entirely", async () => {
    const { data: v } = await recv.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_receiving",
        created_by: recv.userId,
      })
      .select("id")
      .single();
    await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 200, grade: "A", recorded_by: recv.userId });
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      unit_price: 1500,
      agreement_status: "agreed",
      payment_terms: "immediate",
      priced_by: mgr.userId,
    });
    const { data } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(data?.state).toBe("in_accounting");

    const { data: pr } = await adminClient()
      .from("processing_records")
      .select("id")
      .eq("visit_id", v!.id);
    expect(pr?.length).toBe(0);
  });
});
