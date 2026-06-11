import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("consumables RLS (categorized log)", () => {
  let siteAId: string, siteBId: string;
  let invA: TestUser, invB: TestUser, recvA: TestUser, owner: TestUser;

  async function insertConsumable(siteId: string) {
    const name = `Consumable-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await adminClient()
      .from("consumables")
      .insert({ site_id: siteId, name, category: "fuel_lubricants" })
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
    recvA = await makeUser({ username: "cons-recv-a", role: "receiving", siteId: siteAId });
    owner = await makeUser({ username: "cons-owner",  role: "owner",     siteId: null });
  });

  it("inventory at site A can log a consumable for site A", async () => {
    const { error } = await invA.client.from("consumables").insert({
      site_id: siteAId,
      name: "Diesel",
      category: "fuel_lubricants",
      comment: "Weekly refill",
      recorded_by: invA.userId,
    });
    expect(error).toBeNull();
  });

  it("rejects an unknown category", async () => {
    const { error } = await invA.client.from("consumables").insert({
      site_id: siteAId,
      name: "Bad",
      category: "not_a_category",
    });
    expect(error).not.toBeNull();
  });

  it("inventory at site B cannot log a consumable for site A", async () => {
    const { error } = await invB.client.from("consumables").insert({
      site_id: siteAId,
      name: "Diesel-Hack",
      category: "transport",
    });
    expect(error).not.toBeNull();
  });

  it("non-inventory role cannot log a consumable", async () => {
    const { error } = await recvA.client.from("consumables").insert({
      site_id: siteAId,
      name: "Recv-Diesel",
      category: "utility",
    });
    expect(error).not.toBeNull();
  });

  it("inventory at site A can read own site consumables", async () => {
    await insertConsumable(siteAId);
    const { data, error } = await invA.client
      .from("consumables")
      .select("id, category, entry_date")
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

  it("owner can read all consumables across sites", async () => {
    const { data, error } = await owner.client.from("consumables").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("entry_date defaults to today when omitted", async () => {
    const id = await insertConsumable(siteAId);
    const { data } = await adminClient()
      .from("consumables")
      .select("entry_date")
      .eq("id", id)
      .single();
    expect(data!.entry_date).toBe(new Date().toISOString().slice(0, 10));
  });
});
