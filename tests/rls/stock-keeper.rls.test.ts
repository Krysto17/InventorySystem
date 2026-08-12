import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The store keeper counts their own store: tick what is on the shelf, dispute
// what is missing or short. They see nothing but stock.
describe("store keeper confirms and disputes stock", () => {
  let siteA: string, siteB: string, material: string, supplierId: string;
  let keeper: TestUser, keeperB: TestUser, owner: TestUser, mgrA: TestUser, recv: TestUser;

  const lot = async (siteId: string, weight = 100) => {
    const { data } = await adminClient().from("stock_lots").insert({
      site_id: siteId, material_type_id: material, supplier_id: supplierId,
      weight_kg: weight, cost_price_per_kg: 500, status: "available",
    }).select("id").single();
    return data!.id as string;
  };
  const check = async (lotId: string) =>
    (await adminClient().from("stock_confirmations").select("*").eq("stock_lot_id", lotId).maybeSingle()).data;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site" && s.id !== siteA)!.id as string;
    keeper = await makeUser({ username: "sk-keeper", role: "stock_keeper", siteId: siteA });
    keeperB = await makeUser({ username: "sk-keeper-b", role: "stock_keeper", siteId: siteB });
    owner = await makeUser({ username: "sk-owner", role: "owner", siteId: null });
    mgrA = await makeUser({ username: "sk-mgr", role: "manager", siteId: siteA });
    recv = await makeUser({ username: "sk-recv", role: "receiving", siteId: siteA });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `SK ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Store-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
  });

  it("ticks a lot as present, recording what was counted", async () => {
    const id = await lot(siteA, 80);
    const { error } = await keeper.client.rpc("record_stock_check", {
      p_lot_id: id, p_status: "confirmed", p_counted_weight: 80,
    });
    expect(error).toBeNull();
    const row = await check(id);
    expect(row!.status).toBe("confirmed");
    expect(Number(row!.counted_weight_kg)).toBe(80);
    expect(row!.checked_by).toBe(keeper.userId);
  });

  it("disputes material that is not there, with the reason", async () => {
    const id = await lot(siteA, 50);
    const { error } = await keeper.client.rpc("record_stock_check", {
      p_lot_id: id, p_status: "disputed", p_note: "Not in the store at all",
    });
    expect(error).toBeNull();
    const row = await check(id);
    expect(row!.status).toBe("disputed");
    expect(row!.dispute_note).toBe("Not in the store at all");
    expect(row!.counted_weight_kg).toBeNull();
  });

  it("disputes a short weight, keeping what was actually found", async () => {
    const id = await lot(siteA, 100);
    await keeper.client.rpc("record_stock_check", {
      p_lot_id: id, p_status: "disputed", p_counted_weight: 60, p_note: "40kg short of the books",
    });
    const row = await check(id);
    expect(Number(row!.counted_weight_kg)).toBe(60);
  });

  it("refuses a dispute with no reason", async () => {
    const id = await lot(siteA);
    const { error } = await keeper.client.rpc("record_stock_check", {
      p_lot_id: id, p_status: "disputed", p_note: "   ",
    });
    expect(error).not.toBeNull();
    expect(await check(id)).toBeNull();
  });

  it("re-counting updates the same row rather than piling up", async () => {
    const id = await lot(siteA, 30);
    await keeper.client.rpc("record_stock_check", { p_lot_id: id, p_status: "disputed", p_note: "Missing" });
    await keeper.client.rpc("record_stock_check", { p_lot_id: id, p_status: "confirmed", p_counted_weight: 30 });
    const { data: rows } = await adminClient().from("stock_confirmations").select("id, status").eq("stock_lot_id", id);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("confirmed");
  });

  it("cannot check another store's stock", async () => {
    const id = await lot(siteB);
    const { error } = await keeperB.client.rpc("record_stock_check", { p_lot_id: id, p_status: "confirmed" });
    expect(error).toBeNull(); // their own site is fine

    const other = await lot(siteA);
    expect((await keeperB.client.rpc("record_stock_check", { p_lot_id: other, p_status: "confirmed" })).error)
      .not.toBeNull();
    expect(await check(other)).toBeNull();
  });

  it("cannot check material that is not in stock", async () => {
    const id = await lot(siteA);
    await adminClient().from("stock_lots").update({ status: "sold" }).eq("id", id);
    expect((await keeper.client.rpc("record_stock_check", { p_lot_id: id, p_status: "confirmed" })).error)
      .not.toBeNull();
  });

  it("the manager and owner see everything the keeper recorded", async () => {
    const id = await lot(siteA, 12);
    await keeper.client.rpc("record_stock_check", {
      p_lot_id: id, p_status: "disputed", p_counted_weight: 5, p_note: "Short by 7kg",
    });

    const seen = (await mgrA.client.from("stock_confirmations")
      .select("status, counted_weight_kg, dispute_note, checked_by").eq("stock_lot_id", id)).data;
    expect(seen).toHaveLength(1);
    expect(seen![0].dispute_note).toBe("Short by 7kg");
    expect(Number(seen![0].counted_weight_kg)).toBe(5);
    expect(seen![0].checked_by).toBe(keeper.userId);

    expect((await owner.client.from("stock_confirmations").select("id").eq("stock_lot_id", id)).data).toHaveLength(1);
  });

  // A store with no keeper of its own is walked by the site manager.
  it("the site manager can run the check on their own store", async () => {
    const id = await lot(siteA, 20);
    expect((await mgrA.client.rpc("record_stock_check", {
      p_lot_id: id, p_status: "confirmed", p_counted_weight: 20,
    })).error).toBeNull();
    const row = await check(id);
    expect(row!.status).toBe("confirmed");
    expect(row!.checked_by).toBe(mgrA.userId);

    // …and disputes it the same way.
    await mgrA.client.rpc("record_stock_check", { p_lot_id: id, p_status: "disputed", p_note: "Recounted, 5kg missing" });
    expect((await check(id))!.status).toBe("disputed");
  });

  it("a manager cannot check another site's store", async () => {
    const id = await lot(siteB);
    expect((await mgrA.client.rpc("record_stock_check", { p_lot_id: id, p_status: "confirmed" })).error)
      .not.toBeNull();
    expect(await check(id)).toBeNull();
  });

  it("roles with no business in the store still cannot check it", async () => {
    const id = await lot(siteA);
    expect((await recv.client.rpc("record_stock_check", { p_lot_id: id, p_status: "confirmed" })).error)
      .not.toBeNull();
    expect(await check(id)).toBeNull();
  });

  it("keeps the keeper out of the rest of the business", async () => {
    // Stock is their world; supplier money and visits are not.
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteA, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteA, materials_total: 900, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 900,
      submitted_by: recv.userId, status: "approved",
    });
    expect((await keeper.client.from("batch_settlements").select("id").eq("visit_id", v!.id)).data ?? [])
      .toHaveLength(0);
    expect((await keeper.client.from("advances").select("id")).data ?? []).toHaveLength(0);

    // But they do see the lots in their own store.
    const id = await lot(siteA, 7);
    expect((await keeper.client.from("stock_lots").select("id").eq("id", id)).data).toHaveLength(1);
  });
});
