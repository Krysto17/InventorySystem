import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Work that never touched a visit was unrecordable, so whole accounts — the
// inventory officer above all — had no history at all.
describe("the audit trail covers every account", () => {
  let siteId: string, supplierId: string, material: string;
  let owner: TestUser, inv: TestUser, mgr: TestUser, recv: TestUser, keeper: TestUser;

  const actionsBy = async (actorId: string, entity?: string) => {
    let q = adminClient().from("audit_trail").select("entity, event_type, actor_id").eq("actor_id", actorId);
    if (entity) q = q.eq("entity", entity);
    return (await q).data ?? [];
  };

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "au-owner", role: "owner", siteId: null });
    inv = await makeUser({ username: "au-inv", role: "inventory", siteId });
    mgr = await makeUser({ username: "au-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "au-recv", role: "receiving", siteId });
    keeper = await makeUser({ username: "au-keeper", role: "stock_keeper", siteId });
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `AU ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `AU-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
  });

  it("records the inventory officer logging an expense", async () => {
    const { error } = await inv.client.from("consumables").insert({
      site_id: siteId, name: `Diesel ${Date.now()}`, category: "fuel_lubricants", amount_naira: 9000,
    });
    expect(error).toBeNull();
    const rows = await actionsBy(inv.userId, "consumables");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].event_type).toBe("record_created");
  });

  it("records a manager recording an advance", async () => {
    const { error } = await mgr.client.from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "Fuel money", amount_naira: 5000,
    });
    expect(error).toBeNull();
    expect((await actionsBy(mgr.userId, "advances")).length).toBeGreaterThan(0);
  });

  it("records a supplier's bank details being changed, and what changed", async () => {
    await mgr.client.from("suppliers").update({
      account_name: "Musa Ahmed", account_number: "0101010101", bank_name: "Zenith",
    }).eq("id", supplierId);
    const { data } = await adminClient().from("audit_trail")
      .select("payload").eq("actor_id", mgr.userId).eq("entity", "suppliers").limit(1).single();
    const diff = (data!.payload as { diff?: Record<string, unknown> }).diff!;
    expect(Object.keys(diff)).toContain("account_number");
  });

  it("records the store keeper counting the store", async () => {
    const { data: lot } = await adminClient().from("stock_lots").insert({
      site_id: siteId, material_type_id: material, supplier_id: supplierId,
      weight_kg: 20, cost_price_per_kg: 100, status: "available",
    }).select("id").single();
    await keeper.client.rpc("record_stock_check", {
      p_lot_id: lot!.id, p_status: "confirmed", p_counted_weight: 20,
    });
    expect((await actionsBy(keeper.userId, "stock_confirmations")).length).toBeGreaterThan(0);
  });

  it("keeps the trail when the batch it described is deleted", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "in_qc", created_by: recv.userId,
    }).select("id").single();
    const visitId = v!.id as string;
    await adminClient().from("visit_materials")
      .insert({ visit_id: visitId, material_type_id: material, weight_kg: 15 });

    const before = (await adminClient().from("transaction_events").select("id").eq("visit_id", visitId)).data!.length;
    expect(before).toBeGreaterThan(0);

    expect((await recv.client.rpc("delete_batch", { p_visit_id: visitId })).error).toBeNull();

    // The visit is gone; its history is not. Read it through the trail, which
    // recovers the entity from the payload for events written before 0143.
    const { data: orphans } = await owner.client.from("audit_trail")
      .select("id, visit_id, entity").is("visit_id", null).eq("entity", "visit_materials");
    expect((orphans ?? []).length).toBeGreaterThan(0);
  });

  it("does not record an update that changed nothing", async () => {
    const { data: c } = await adminClient().from("consumables").insert({
      site_id: siteId, name: `NoOp ${Date.now()}`, category: "others", amount_naira: 100,
    }).select("id, amount_naira").single();
    const before = (await adminClient().from("transaction_events")
      .select("id").eq("entity", "consumables").eq("entity_id", c!.id)).data!.length;
    await adminClient().from("consumables").update({ amount_naira: c!.amount_naira }).eq("id", c!.id);
    const after = (await adminClient().from("transaction_events")
      .select("id").eq("entity", "consumables").eq("entity_id", c!.id)).data!.length;
    expect(after).toBe(before);
  });

  it("the owner reads every account's trail; a site role reads only its own site", async () => {
    const all = (await owner.client.from("audit_trail").select("id").limit(500)).data ?? [];
    expect(all.length).toBeGreaterThan(0);

    // The manager sees their site's events, never another site's.
    const { data: mine } = await mgr.client.from("audit_trail").select("site_id, visit_id").limit(200);
    expect((mine ?? []).every((r) => r.site_id === null || r.site_id === siteId)).toBe(true);
  });

  it("counts actions per account for the audit screen", async () => {
    const { data, error } = await owner.client.rpc("audit_counts_by_actor");
    expect(error).toBeNull();
    const row = (data as { actor_id: string; events: number }[]).find((r) => r.actor_id === inv.userId);
    expect(Number(row!.events)).toBeGreaterThan(0);
  });
});
