import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The owner marks a price AGREED so the manager knows it's ready to forward for
// payment. It doesn't lock the price — the owner may still revise it.
describe("price agreed flag", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "pa-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "pa-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "pa-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `PA ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function line() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }).select("id").single();
    const { data: l } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 100, unit_price: 50,
      requires_analysis: false, recorded_by: recv.userId,
    }).select("id").single();
    return l!.id as string;
  }
  const row = async (id: string) =>
    (await adminClient().from("visit_materials").select("price_agreed, price_agreed_by, price_agreed_at, unit_price").eq("id", id).single()).data!;

  it("owner agrees a price — stamped with who and when", async () => {
    const id = await line();
    const { error } = await owner.client.from("visit_materials").update({ price_agreed: true }).eq("id", id);
    expect(error).toBeNull();
    const r = await row(id);
    expect(r.price_agreed).toBe(true);
    expect(r.price_agreed_by).toBe(owner.userId);
    expect(r.price_agreed_at).not.toBeNull();
  });

  it("the price stays editable after agreeing", async () => {
    const id = await line();
    await owner.client.from("visit_materials").update({ price_agreed: true }).eq("id", id);
    const { error } = await owner.client.from("visit_materials").update({ unit_price: 75 }).eq("id", id);
    expect(error).toBeNull();
    const r = await row(id);
    expect(Number(r.unit_price)).toBe(75);
    expect(r.price_agreed).toBe(true); // still agreed
  });

  it("withdrawing the agreement clears the stamp", async () => {
    const id = await line();
    await owner.client.from("visit_materials").update({ price_agreed: true }).eq("id", id);
    await owner.client.from("visit_materials").update({ price_agreed: false }).eq("id", id);
    const r = await row(id);
    expect(r.price_agreed).toBe(false);
    expect(r.price_agreed_by).toBeNull();
    expect(r.price_agreed_at).toBeNull();
  });

  it("a manager cannot agree a price", async () => {
    const id = await line();
    const { error } = await mgr.client.from("visit_materials").update({ price_agreed: true }).eq("id", id);
    expect(error).not.toBeNull();
    expect((await row(id)).price_agreed).toBe(false);
  });

  it("the manager can still price the line normally", async () => {
    const id = await line();
    const { error } = await mgr.client.from("visit_materials").update({ unit_price: 60 }).eq("id", id);
    expect(error).toBeNull();
  });
});
