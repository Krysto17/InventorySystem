import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("consumables + consumable_movements RLS", () => {
  let siteAId: string, siteBId: string;
  let invA: TestUser, invB: TestUser, gateA: TestUser, owner: TestUser;

  async function insertConsumable(siteId: string) {
    const name = `Consumable-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await adminClient()
      .from("consumables")
      .insert({ site_id: siteId, name, on_hand: 100, unit: "L" })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    invA  = await makeUser({ username: "cons-inv-a",  role: "inventory", siteId: siteAId });
    invB  = await makeUser({ username: "cons-inv-b",  role: "inventory", siteId: siteBId });
    gateA = await makeUser({ username: "cons-gate-a", role: "gate",      siteId: siteAId });
    owner = await makeUser({ username: "cons-owner",  role: "owner",     siteId: null });
  });

  // ── consumables ────────────────────────────────────────────────────────────

  it("inventory at site A can insert a consumable for site A", async () => {
    const { error } = await invA.client.from("consumables").insert({
      site_id: siteAId,
      name: "Diesel-A",
      on_hand: 50,
      unit: "L",
    });
    expect(error).toBeNull();
  });

  it("inventory at site B cannot insert a consumable for site A", async () => {
    const { error } = await invB.client.from("consumables").insert({
      site_id: siteAId,
      name: "Diesel-Hack",
      unit: "L",
    });
    expect(error).not.toBeNull();
  });

  it("non-inventory role cannot insert a consumable", async () => {
    const { error } = await gateA.client.from("consumables").insert({
      site_id: siteAId,
      name: "Gate-Diesel",
    });
    expect(error).not.toBeNull();
  });

  it("inventory at site A can read own site consumables", async () => {
    await insertConsumable(siteAId);
    const { data, error } = await invA.client
      .from("consumables")
      .select("id")
      .eq("site_id", siteAId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("inventory at site A cannot read site B consumables", async () => {
    await insertConsumable(siteBId);
    const { data } = await invA.client
      .from("consumables")
      .select("id")
      .eq("site_id", siteBId);
    expect(data?.length).toBe(0);
  });

  // ── consumable_movements ───────────────────────────────────────────────────

  it("inventory at site A can insert movement for site A consumable", async () => {
    const cId = await insertConsumable(siteAId);
    const { error } = await invA.client.from("consumable_movements").insert({
      consumable_id: cId,
      delta: -10,
      recorded_by: invA.userId,
      reason: "used",
    });
    expect(error).toBeNull();
  });

  it("on_hand is updated by movement trigger", async () => {
    const cId = await insertConsumable(siteAId);
    await adminClient().from("consumable_movements").insert({
      consumable_id: cId,
      delta: -30,
      recorded_by: invA.userId,
    });
    const { data } = await adminClient()
      .from("consumables")
      .select("on_hand")
      .eq("id", cId)
      .single();
    expect(Number(data?.on_hand)).toBe(70); // 100 - 30
  });

  it("inventory at site B cannot insert movement for site A consumable", async () => {
    const cId = await insertConsumable(siteAId);
    const { error } = await invB.client.from("consumable_movements").insert({
      consumable_id: cId,
      delta: -5,
      recorded_by: invB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("non-inventory cannot insert consumable movement", async () => {
    const cId = await insertConsumable(siteAId);
    const { error } = await gateA.client.from("consumable_movements").insert({
      consumable_id: cId,
      delta: -1,
      recorded_by: gateA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("owner can read all consumables and movements", async () => {
    const { data: c, error: ce } = await owner.client.from("consumables").select("id");
    expect(ce).toBeNull();
    expect(c!.length).toBeGreaterThan(0);

    const { data: mv, error: me } = await owner.client.from("consumable_movements").select("id");
    expect(me).toBeNull();
    expect(mv!.length).toBeGreaterThan(0);
  });
});
