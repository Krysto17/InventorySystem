import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// settlement_totals is the single source; approve_pricing snapshots a
// self-reconciling row (materials − fee − other − advances = net).
describe("settlement_totals single source", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "stot-owner", role: "owner", siteId: null });
    recv = await makeUser({ username: "stot-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `STOT ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  it("computes the breakdown and stores a reconciling snapshot", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "awaiting_price_approval", created_by: recv.userId,
    }).select("id").single();
    const visitId = v!.id as string;
    await adminClient().from("visit_materials").insert({ visit_id: visitId, material_type_id: monazite, weight_kg: 100, unit_price: 50, requires_analysis: false, recorded_by: recv.userId });
    await adminClient().from("utility_charges").insert([
      { visit_id: visitId, kind: "light_bill", description: "Processing fee", amount: 500, recorded_by: recv.userId },
      { visit_id: visitId, kind: "other", description: "Transport", amount: 300, recorded_by: recv.userId },
    ]);
    // Paid advance ₦1000 → debt; deduct ₦400.
    await adminClient().from("advances").insert({ supplier_id: supplierId, site_id: siteId, purpose: "float", amount_naira: 1000, approval_status: "paid", recorded_by: recv.userId });
    await adminClient().from("advance_deductions").insert({ supplier_id: supplierId, site_id: siteId, ref_visit_id: visitId, amount: 400, recorded_by: recv.userId });

    const { data: totals } = await adminClient().rpc("settlement_totals", { p_visit_id: visitId });
    const t = totals![0];
    expect(Number(t.materials)).toBe(5000);
    expect(Number(t.processing_fee)).toBe(500);
    expect(Number(t.other_deductions)).toBe(300);
    expect(Number(t.advances)).toBe(400);
    expect(Number(t.net)).toBe(3800);

    const { error } = await owner.client.rpc("approve_pricing", { p_visit_id: visitId });
    expect(error).toBeNull();
    const { data: bs } = await adminClient().from("batch_settlements")
      .select("materials_total, light_bill_total, other_deductions_total, advance_deducted, net_balance").eq("visit_id", visitId).single();
    // The snapshot reconciles on its own.
    expect(Number(bs!.net_balance)).toBe(3800);
    expect(Number(bs!.materials_total) - Number(bs!.light_bill_total) - Number(bs!.other_deductions_total) - Number(bs!.advance_deducted)).toBe(Number(bs!.net_balance));
  });
});
