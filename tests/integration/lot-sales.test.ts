import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("lot-tracked bulk sales (integration + RLS)", () => {
  let siteAId: string, siteBId: string;
  let invA: TestUser, invB: TestUser, owner: TestUser;
  let materialId: string, supA: string, supB: string;

  async function newLot(siteId: string, supplierId: string, weight: number, cost: number) {
    const { data, error } = await adminClient().from("stock_lots").insert({
      site_id: siteId, material_type_id: materialId, supplier_id: supplierId,
      weight_kg: weight, cost_price_per_kg: cost, recorded_by: invA.userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }

  async function newSale(siteId: string, userId: string) {
    const { data, error } = await adminClient().from("lot_sales").insert({
      site_id: siteId, material_type_id: materialId, buyer_name: "Acme Metals", recorded_by: userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    invA  = await makeUser({ username: "lot-inv-a", role: "inventory", siteId: siteAId });
    invB  = await makeUser({ username: "lot-inv-b", role: "inventory", siteId: siteBId });
    owner = await makeUser({ username: "lot-owner", role: "owner",     siteId: null });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialId = m!.id as string;
    const { data: s1 } = await adminClient().from("suppliers").insert({ name: "Supplier One" }).select("id").single();
    const { data: s2 } = await adminClient().from("suppliers").insert({ name: "Supplier Two" }).select("id").single();
    supA = s1!.id as string;
    supB = s2!.id as string;
  });

  it("inventory creates lots on its own site", async () => {
    const { error } = await invA.client.from("stock_lots").insert({
      site_id: siteAId, material_type_id: materialId, supplier_id: supA,
      weight_kg: 100, cost_price_per_kg: 50, recorded_by: invA.userId,
    });
    expect(error).toBeNull();
  });

  it("inventory cannot create a lot on another site", async () => {
    const { error } = await invB.client.from("stock_lots").insert({
      site_id: siteAId, material_type_id: materialId, weight_kg: 10, cost_price_per_kg: 1, recorded_by: invB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("approving a lot sale marks lots SOLD and computes the average cost price", async () => {
    const lot1 = await newLot(siteAId, supA, 120, 100); // 12,000
    const lot2 = await newLot(siteAId, supB, 80, 150);  // 12,000
    const saleId = await newSale(siteAId, invA.userId);
    const { error: i1 } = await invA.client.from("lot_sale_items").insert({ lot_sale_id: saleId, stock_lot_id: lot1 });
    const { error: i2 } = await invA.client.from("lot_sale_items").insert({ lot_sale_id: saleId, stock_lot_id: lot2 });
    expect(i1).toBeNull();
    expect(i2).toBeNull();

    // Owner approves
    const { error: ae } = await owner.client.from("lot_sales").update({ approval_status: "approved" }).eq("id", saleId);
    expect(ae).toBeNull();

    // Lots are now sold
    const { data: lots } = await adminClient().from("stock_lots").select("status").in("id", [lot1, lot2]);
    expect(lots!.every((l) => l.status === "sold")).toBe(true);

    // Snapshot: total weight 200, total cost 24,000, avg 120/kg
    const { data: sale } = await adminClient()
      .from("lot_sales").select("total_weight_kg, total_cost_price, avg_cost_price_per_kg").eq("id", saleId).single();
    expect(Number(sale!.total_weight_kg)).toBe(200);
    expect(Number(sale!.total_cost_price)).toBe(24000);
    expect(Number(sale!.avg_cost_price_per_kg)).toBe(120);
  });

  it("a sold lot cannot be added to a new sale", async () => {
    const lot = await newLot(siteAId, supA, 50, 80);
    const sale1 = await newSale(siteAId, invA.userId);
    await invA.client.from("lot_sale_items").insert({ lot_sale_id: sale1, stock_lot_id: lot });
    await owner.client.from("lot_sales").update({ approval_status: "approved" }).eq("id", sale1);

    const sale2 = await newSale(siteAId, invA.userId);
    const { error } = await invA.client.from("lot_sale_items").insert({ lot_sale_id: sale2, stock_lot_id: lot });
    expect(error).not.toBeNull();
  });

  it("a lot already in a pending sale cannot be double-booked", async () => {
    const lot = await newLot(siteAId, supA, 30, 20);
    const sale1 = await newSale(siteAId, invA.userId);
    await invA.client.from("lot_sale_items").insert({ lot_sale_id: sale1, stock_lot_id: lot });
    const sale2 = await newSale(siteAId, invA.userId);
    const { error } = await invA.client.from("lot_sale_items").insert({ lot_sale_id: sale2, stock_lot_id: lot });
    expect(error).not.toBeNull();
  });

  it("non-owner cannot approve a lot sale", async () => {
    const lot = await newLot(siteAId, supA, 10, 10);
    const sale = await newSale(siteAId, invA.userId);
    await invA.client.from("lot_sale_items").insert({ lot_sale_id: sale, stock_lot_id: lot });
    await invA.client.from("lot_sales").update({ approval_status: "approved" }).eq("id", sale);
    const { data } = await adminClient().from("lot_sales").select("approval_status").eq("id", sale).single();
    expect(data!.approval_status).toBe("pending"); // unchanged — RLS blocked the update
  });

  it("inventory at site B cannot read site A lots", async () => {
    const lot = await newLot(siteAId, supA, 10, 10);
    const { data } = await invB.client.from("stock_lots").select("id").eq("id", lot);
    expect(data ?? []).toHaveLength(0);
  });
});
