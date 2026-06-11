import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("visit_materials RLS (batch line items)", () => {
  let siteAId: string, siteBId: string;
  let recvA: TestUser, recvB: TestUser, mgrA: TestUser, acctA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newVisit(siteId: string, state = "in_receiving") {
    const { data, error } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state,
        created_by: recvA.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  async function addLine(visitId: string) {
    const { data, error } = await adminClient()
      .from("visit_materials")
      .insert({ visit_id: visitId, material_type_id: materialTypeId, weight_kg: 100, recorded_by: recvA.userId })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    recvA = await makeUser({ username: "vm-recv-a", role: "receiving",  siteId: siteAId });
    recvB = await makeUser({ username: "vm-recv-b", role: "receiving",  siteId: siteBId });
    mgrA  = await makeUser({ username: "vm-mgr-a",  role: "manager",    siteId: siteAId });
    acctA = await makeUser({ username: "vm-acct-a", role: "accounting", siteId: siteAId });
    owner = await makeUser({ username: "vm-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "VM Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("receiving at site A adds a material line to an in_receiving visit", async () => {
    const v = await newVisit(siteAId);
    const { error } = await recvA.client.from("visit_materials").insert({
      visit_id: v, material_type_id: materialTypeId, weight_kg: 120,
      magnetic_analysis: "60% magnetic", recorded_by: recvA.userId,
    });
    expect(error).toBeNull();
  });

  it("a visit can hold MULTIPLE material lines (one batch, many materials)", async () => {
    const v = await newVisit(siteAId);
    await recvA.client.from("visit_materials").insert({ visit_id: v, material_type_id: materialTypeId, weight_kg: 80, recorded_by: recvA.userId });
    await recvA.client.from("visit_materials").insert({ visit_id: v, material_type_id: materialTypeId, weight_kg: 40, recorded_by: recvA.userId });
    const { data } = await recvA.client.from("visit_materials").select("id").eq("visit_id", v);
    expect(data!.length).toBe(2);
  });

  it("receiving at site B cannot add a line to a site A visit", async () => {
    const v = await newVisit(siteAId);
    const { error } = await recvB.client.from("visit_materials").insert({
      visit_id: v, material_type_id: materialTypeId, weight_kg: 10, recorded_by: recvB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("accounting cannot add a line", async () => {
    const v = await newVisit(siteAId);
    const { error } = await acctA.client.from("visit_materials").insert({
      visit_id: v, material_type_id: materialTypeId, weight_kg: 10, recorded_by: acctA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("manager can assign an optional per-line price; purchase_amount is computed", async () => {
    const v = await newVisit(siteAId);
    const lineId = await addLine(v); // weight 100
    const { error } = await mgrA.client.from("visit_materials")
      .update({ unit_price: 250, priced_by: mgrA.userId }).eq("id", lineId);
    expect(error).toBeNull();
    const { data } = await adminClient().from("visit_materials").select("purchase_amount").eq("id", lineId).single();
    expect(Number(data!.purchase_amount)).toBe(25000); // 100 * 250
  });

  it("receiving at site B cannot read site A lines", async () => {
    const v = await newVisit(siteAId);
    await addLine(v);
    const { data } = await recvB.client.from("visit_materials").select("id").eq("visit_id", v);
    expect(data ?? []).toHaveLength(0);
  });

  it("owner can read lines across sites", async () => {
    const v = await newVisit(siteBId);
    await addLine(v);
    const { data } = await owner.client.from("visit_materials").select("id").eq("visit_id", v);
    expect(data!.length).toBeGreaterThan(0);
  });
});
