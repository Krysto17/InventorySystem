import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("payments RLS", () => {
  let siteAId: string, siteBId: string;
  let acctA: TestUser, acctB: TestUser, gateA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newInAccountingVisit(siteId: string, creatorId: string) {
    const { data } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_accounting",
        created_by: creatorId,
      })
      .select("id")
      .single();
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    acctA = await makeUser({ username: "pay-acct-a", role: "accounting", siteId: siteAId });
    acctB = await makeUser({ username: "pay-acct-b", role: "accounting", siteId: siteBId });
    gateA = await makeUser({ username: "pay-gate-a", role: "receiving", siteId: siteAId });
    owner = await makeUser({ username: "pay-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Pay Supp", phone: "07011121314" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("accounting at site A can insert payment for site A visit", async () => {
    const vid = await newInAccountingVisit(siteAId, acctA.userId);
    const { error } = await acctA.client.from("payments").insert({
      visit_id: vid,
      direction: "processing_fee_in",
      amount: 500,
      method: "cash",
      recorded_by: acctA.userId,
    });
    expect(error).toBeNull();
  });

  it("accounting at site B cannot insert payment for site A visit", async () => {
    const vid = await newInAccountingVisit(siteAId, acctA.userId);
    const { error } = await acctB.client.from("payments").insert({
      visit_id: vid,
      direction: "processing_fee_in",
      amount: 500,
      recorded_by: acctB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("non-accounting role cannot insert payment", async () => {
    const vid = await newInAccountingVisit(siteAId, gateA.userId);
    const { error } = await gateA.client.from("payments").insert({
      visit_id: vid,
      direction: "processing_fee_in",
      amount: 100,
      recorded_by: gateA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("accounting can read payments for own site", async () => {
    const vid = await newInAccountingVisit(siteAId, acctA.userId);
    await adminClient().from("payments").insert({
      visit_id: vid,
      direction: "processing_fee_in",
      amount: 250,
      recorded_by: acctA.userId,
    });
    const { data, error } = await acctA.client
      .from("payments")
      .select("id")
      .eq("visit_id", vid);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // Cross-site read belongs to the GENERAL accountant (the one posted to
  // New-Site/HQ), not to every site accountant.
  it("a site accountant cannot read another site's payments; the general accountant can", async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const hq = sites!.find((s) => s.name === "New-Site")!.id as string;
    const siteX = sites!.find((s) => s.name !== "New-Site")!.id as string;
    const siteY = sites!.find((s) => s.name !== "New-Site" && s.id !== siteX)!.id as string;

    const siteAcct = await makeUser({ username: "pay-acct-site", role: "accounting", siteId: siteX });
    const genAcct = await makeUser({ username: "pay-acct-gen", role: "accounting", siteId: hq });

    const vid = await newInAccountingVisit(siteY, acctB.userId);
    await adminClient().from("payments").insert({
      visit_id: vid,
      direction: "processing_fee_in",
      amount: 300,
      recorded_by: acctB.userId,
    });

    const { data: blocked } = await siteAcct.client.from("payments").select("id").eq("visit_id", vid);
    expect(blocked ?? []).toHaveLength(0);

    const { data: allowed } = await genAcct.client.from("payments").select("id").eq("visit_id", vid);
    expect(allowed).toHaveLength(1);
  });

  it("owner can read payments across all sites", async () => {
    const { data, error } = await owner.client.from("payments").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });
});
