import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The advance and expense lists are capped at a page of rows, so searching in
// the browser would only ever search the newest page. Both filter in Postgres.
describe("advance and expense lists are searchable and filterable", () => {
  let siteA: string, siteB: string;
  let owner: TestUser, mgrA: TestUser;
  let alpha: string, beta: string;
  const tag = Date.now();

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site" && s.id !== siteA)!.id as string;
    owner = await makeUser({ username: "ls-owner", role: "owner", siteId: null });
    mgrA = await makeUser({ username: "ls-mgr", role: "manager", siteId: siteA });

    const { data: a } = await adminClient().from("suppliers")
      .insert({ name: `Zamfara Traders ${tag}` }).select("id").single();
    alpha = a!.id as string;
    const { data: b } = await adminClient().from("suppliers")
      .insert({ name: `Kaduna Minerals ${tag}` }).select("id").single();
    beta = b!.id as string;

    await adminClient().from("advances").insert([
      { supplier_id: alpha, site_id: siteA, purpose: "Diesel float", amount_naira: 50_000, approval_status: "pending" },
      { supplier_id: beta,  site_id: siteA, purpose: "Transport",    amount_naira: 20_000, approval_status: "paid" },
      { supplier_id: alpha, site_id: siteB, purpose: "Transport",    amount_naira: 10_000, approval_status: "pending" },
    ]);
  });

  it("finds an advance by the supplier's name", async () => {
    const { data } = await owner.client.from("advance_list")
      .select("supplier_name, purpose")
      .ilike("supplier_name", `%Zamfara Traders ${tag}%`);
    expect(data!.length).toBe(2);
    expect(data!.every((r) => (r.supplier_name as string).includes("Zamfara"))).toBe(true);
  });

  it("finds an advance by its purpose", async () => {
    const { data } = await owner.client.from("advance_list")
      .select("id, purpose, supplier_name")
      .eq("purpose", "Diesel float")
      .ilike("supplier_name", `%${tag}%`);
    expect(data).toHaveLength(1);
  });

  it("filters by status", async () => {
    const { data: paid } = await owner.client.from("advance_list")
      .select("id, approval_status").eq("approval_status", "paid").ilike("supplier_name", `%${tag}%`);
    expect(paid).toHaveLength(1);

    const { data: pending } = await owner.client.from("advance_list")
      .select("id").eq("approval_status", "pending").ilike("supplier_name", `%${tag}%`);
    expect(pending).toHaveLength(2);
  });

  it("combines a search with a status filter", async () => {
    const { data } = await owner.client.from("advance_list")
      .select("id, supplier_name, approval_status")
      .eq("approval_status", "pending")
      .ilike("supplier_name", `%Zamfara Traders ${tag}%`);
    expect(data).toHaveLength(2); // both Zamfara advances are pending
  });

  it("stays site-scoped — a site manager never searches another site", async () => {
    const { data } = await mgrA.client.from("advance_list")
      .select("id, site_id").ilike("supplier_name", `%${tag}%`);
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r) => r.site_id === siteA)).toBe(true);
  });

  it("expenses filter and search on their own columns", async () => {
    await adminClient().from("consumables").insert([
      { site_id: siteA, name: `Grease drum ${tag}`, category: "fuel_lubricants", amount_naira: 8000, approval_status: "pending" },
      { site_id: siteA, name: `Wages week ${tag}`,  category: "wages",           amount_naira: 90000, approval_status: "paid" },
    ]);

    const { data: byName } = await owner.client.from("consumables")
      .select("id, name").ilike("name", `%Grease drum ${tag}%`);
    expect(byName).toHaveLength(1);

    const { data: byCategory } = await owner.client.from("consumables")
      .select("id, category").eq("category", "wages").ilike("name", `%${tag}%`);
    expect(byCategory).toHaveLength(1);

    const { data: byStatus } = await owner.client.from("consumables")
      .select("id").eq("approval_status", "pending").ilike("name", `%${tag}%`);
    expect(byStatus).toHaveLength(1);
  });
});
