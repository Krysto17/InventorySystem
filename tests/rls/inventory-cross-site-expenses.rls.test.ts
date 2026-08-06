import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// One inventory officer runs expenses for the whole organisation: they log an
// expense against any site and correct it until the owner has ruled on it.
describe("inventory runs expenses across every site", () => {
  let siteA: string, siteB: string;
  let inv: TestUser, mgrB: TestUser, owner: TestUser;

  const expense = (siteId: string, status = "pending") =>
    adminClient().from("consumables").insert({
      site_id: siteId, name: `Diesel ${Date.now()}${Math.random()}`, category: "fuel_lubricants",
      amount_naira: 5000, approval_status: status, recorded_by: inv.userId,
      account_name: "MJZ Fuel", account_number: "0123456789", bank_name: "Zenith",
    }).select("id").single();

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site" && s.id !== siteA)!.id as string;
    inv = await makeUser({ username: "ix-inv", role: "inventory", siteId: siteA });
    mgrB = await makeUser({ username: "ix-mgr-b", role: "manager", siteId: siteB });
    owner = await makeUser({ username: "ix-owner", role: "owner", siteId: null });
  });

  it("logs an expense against another site", async () => {
    const { data, error } = await inv.client.from("consumables").insert({
      site_id: siteB, name: "Grease for Old-Site plant", category: "fuel_lubricants",
      amount_naira: 12000, recorded_by: inv.userId,
      account_name: "MJZ Fuel", account_number: "0123456789", bank_name: "Zenith",
    }).select("id, site_id").single();
    expect(error).toBeNull();
    expect(data!.site_id).toBe(siteB);
  });

  it("reads expenses from every site", async () => {
    const { data: a } = await expense(siteA);
    const { data: b } = await expense(siteB);
    const { data: seen } = await inv.client.from("consumables").select("id").in("id", [a!.id, b!.id]);
    expect(seen).toHaveLength(2);
  });

  it("corrects a pending expense on another site", async () => {
    const { data: e } = await expense(siteB);
    const { error } = await inv.client.from("consumables")
      .update({ amount_naira: 7500 }).eq("id", e!.id);
    expect(error).toBeNull();
    const after = (await adminClient().from("consumables").select("amount_naira").eq("id", e!.id).single()).data!;
    expect(Number(after.amount_naira)).toBe(7500);
  });

  it("withdraws a pending expense on another site", async () => {
    const { data: e } = await expense(siteB);
    await inv.client.from("consumables").delete().eq("id", e!.id);
    const { data: gone } = await adminClient().from("consumables").select("id").eq("id", e!.id);
    expect(gone ?? []).toHaveLength(0);
  });

  it("cannot touch an expense the owner has already approved", async () => {
    const { data: e } = await expense(siteB, "approved");
    await inv.client.from("consumables").update({ amount_naira: 1 }).eq("id", e!.id);
    await inv.client.from("consumables").delete().eq("id", e!.id);
    const still = (await adminClient().from("consumables").select("amount_naira").eq("id", e!.id).maybeSingle()).data;
    expect(still).not.toBeNull();
    expect(Number(still!.amount_naira)).toBe(5000);
  });

  it("cannot approve its own expense — that stays with the owner", async () => {
    const { data: e } = await expense(siteA);
    const { error } = await inv.client.from("consumables")
      .update({ approval_status: "approved" }).eq("id", e!.id);
    expect(error).not.toBeNull();

    expect((await owner.client.from("consumables").update({ approval_status: "approved" }).eq("id", e!.id)).error).toBeNull();
  });

  it("a site manager still sees only their own site", async () => {
    const { data: a } = await expense(siteA);
    const { data: seen } = await mgrB.client.from("consumables").select("id").eq("id", a!.id);
    expect(seen ?? []).toHaveLength(0);
  });
});
