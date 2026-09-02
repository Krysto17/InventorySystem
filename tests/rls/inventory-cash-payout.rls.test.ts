import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Cash part payments are counted out by the INVENTORY employee (0150). The
// approval chain is unchanged — the manager prices and submits, the owner
// approves — and inventory only records cash that has actually changed hands:
// never a transfer, never on another site, never before the owner approves.
describe("inventory issues cash against an approved payout", () => {
  let siteId: string, otherSite: string, monazite: string, supplierId: string;
  let owner: TestUser, recv: TestUser, inv: TestUser, otherInv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => (s.id as string) !== siteId)!.id as string;
    owner = await makeUser({ username: "icp-owner", role: "owner", siteId: null });
    recv = await makeUser({ username: "icp-recv", role: "receiving", siteId });
    inv = await makeUser({ username: "icp-inv", role: "inventory", siteId });
    otherInv = await makeUser({ username: "icp-inv2", role: "inventory", siteId: otherSite });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `ICP ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function settlement(net: number, status = "approved", site = siteId) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: site, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 40, unit_price: 0,
      requires_analysis: false, recorded_by: recv.userId,
    });
    const approved = status === "approved";
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: site, materials_total: net, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: net, submitted_by: recv.userId, status,
      approved_by: approved ? owner.userId : null,
      approved_at: approved ? new Date().toISOString() : null,
    }).select("id").single();
    return { visitId: v!.id as string, id: bs!.id as string };
  }

  const statusOf = async (id: string) =>
    (await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!.status as string;

  it("records a cash part payment; the balance stays open until it is cleared", async () => {
    const { id } = await settlement(10000);

    const { error } = await inv.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 4000, p_method: "cash", p_note: "part payment at the gate",
    });
    expect(error).toBeNull();
    expect(await statusOf(id)).toBe("partially_paid");

    const { data: rows } = await adminClient()
      .from("settlement_payments").select("amount, method, paid_by").eq("settlement_id", id);
    expect(rows).toHaveLength(1);
    expect(Number(rows![0].amount)).toBe(4000);
    expect(rows![0].method).toBe("cash");
    expect(rows![0].paid_by).toBe(inv.userId);

    // Clearing the rest closes the payout.
    expect((await inv.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 6000, p_method: "cash",
    })).error).toBeNull();
    expect(await statusOf(id)).toBe("paid");
  });

  it("cannot pay more than the remaining balance", async () => {
    const { id } = await settlement(5000);
    await inv.client.rpc("record_settlement_payment", { p_settlement_id: id, p_amount: 3000, p_method: "cash" });
    const { error } = await inv.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 2500, p_method: "cash",
    });
    expect(error).not.toBeNull();
    expect(await statusOf(id)).toBe("partially_paid");
  });

  it("cannot record a bank transfer — that is accounting's", async () => {
    const { id } = await settlement(5000);
    const { error } = await inv.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 1000, p_method: "transfer",
    });
    expect(error).not.toBeNull();
    expect((await adminClient().from("settlement_payments").select("id").eq("settlement_id", id)).data ?? []).toHaveLength(0);
  });

  it("cannot pay a settlement the owner has not approved yet", async () => {
    const { id } = await settlement(5000, "pending");
    const { error } = await inv.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 1000, p_method: "cash",
    });
    expect(error).not.toBeNull();
    expect(await statusOf(id)).toBe("pending");
  });

  it("cannot pay a settlement on another site", async () => {
    const { id } = await settlement(5000);
    const { error } = await otherInv.client.rpc("record_settlement_payment", {
      p_settlement_id: id, p_amount: 1000, p_method: "cash",
    });
    expect(error).not.toBeNull();
    expect(await statusOf(id)).toBe("approved");
  });

  it("issuing cash approves nothing — inventory still cannot approve a settlement", async () => {
    const { id } = await settlement(5000, "pending");
    await inv.client.from("batch_settlements").update({ status: "approved" }).eq("id", id);
    expect(await statusOf(id)).toBe("pending");
  });

  it("can read the cash it issued on its own site, but not another site's ledger", async () => {
    const { id } = await settlement(2000);
    await inv.client.rpc("record_settlement_payment", { p_settlement_id: id, p_amount: 500, p_method: "cash" });
    expect((await inv.client.from("settlement_payments").select("id").eq("settlement_id", id)).data ?? []).toHaveLength(1);
    expect((await otherInv.client.from("settlement_payments").select("id").eq("settlement_id", id)).data ?? []).toHaveLength(0);
  });
});
