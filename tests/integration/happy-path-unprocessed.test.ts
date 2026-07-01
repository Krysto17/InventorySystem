import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("happy path: unprocessed → agreed → in_accounting", () => {
  let siteId: string;
  let proc: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string, machineId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "hpu-proc", role: "processing", siteId });
    recv = await makeUser({ username: "hpu-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "hpu-mgr", role: "manager", siteId });
    owner = await makeUser({ username: "hpu-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "HPU Supp", phone: "07088880000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: mc } = await adminClient()
      .from("machines")
      .insert({ site_id: siteId, name: "HPU Crusher", charge_basis: "weight", rate: 15 })
      .select("id")
      .single();
    machineId = mc!.id as string;
  });

  it("walks a visit processing → receiving → pricing(agreed) → in_accounting", async () => {
    const { data: v } = await proc.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "in_processing",
        created_by: proc.userId,
      })
      .select("id")
      .single();
    expect(v?.id).toBeTruthy();

    const { data: pr } = await proc.client
      .from("processing_records")
      .insert({ visit_id: v!.id, recorded_by: proc.userId })
      .select("id")
      .single();
    await proc.client.from("processing_machine_usage").insert({
      processing_record_id: pr!.id,
      machine_id: machineId,
      measurement: 320,
      rate_snapshot: 15,
    });

    const { data: state1 } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(state1?.state).toBe("in_receiving");

    await recv.client.from("analysis_records").insert({
      visit_id: v!.id,
      weight: 305,
      grade: "A",
      purity: 65,
      recorded_by: recv.userId,
    });
    const { data: state2 } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(state2?.state).toBe("pricing");

    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      unit_price: 1200,
      agreement_status: "agreed",
      payment_terms: "installment",
      priced_by: mgr.userId,
    });
    // Agreed price parks at the owner approval gate (#1/#5).
    const { data: gate } = await adminClient().from("visits").select("state").eq("id", v!.id).single();
    expect(gate?.state).toBe("awaiting_price_approval");
    await owner.client.rpc("approve_pricing", { p_visit_id: v!.id });
    const { data: state3 } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(state3?.state).toBe("in_accounting");

    const { data: p } = await adminClient()
      .from("pricing")
      .select("purchase_amount")
      .eq("visit_id", v!.id)
      .single();
    expect(Number(p?.purchase_amount)).toBe(305 * 1200);

    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", v!.id)
      .order("created_at");
    const types = events!.map((e) => e.event_type);
    expect(types).toEqual(
      expect.arrayContaining(["visit_created", "state_changed", "record_created"]),
    );
  });
});
