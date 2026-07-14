import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The owner's price approval auto-creates an APPROVED settlement (net after
// deductions) and sends the visit to accounting — no manual submit step.
describe("approve_pricing auto-creates the settlement", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "aps-owner", role: "owner", siteId: null });
    recv = await makeUser({ username: "aps-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `APS ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  it("approval → settlement approved with net = materials − processing fee", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "awaiting_price_approval", created_by: recv.userId,
    }).select("id").single();
    const visitId = v!.id as string;
    // Priced line: 100 kg * ₦50 = ₦5000 materials.
    await adminClient().from("visit_materials").insert({
      visit_id: visitId, material_type_id: monazite, weight_kg: 100, unit_price: 50, requires_analysis: false, recorded_by: recv.userId,
    });
    // Processing fee ₦500 (light bill).
    await adminClient().from("utility_charges").insert({
      visit_id: visitId, kind: "light_bill", description: "Processing fee", amount: 500, recorded_by: recv.userId,
    });

    const { error } = await owner.client.rpc("approve_pricing", { p_visit_id: visitId });
    expect(error).toBeNull();

    const { data: vs } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(vs!.state).toBe("in_accounting");

    const { data: st } = await adminClient().from("batch_settlements").select("status, net_balance, materials_total, light_bill_total").eq("visit_id", visitId).single();
    expect(st!.status).toBe("approved");
    expect(Number(st!.materials_total)).toBe(5000);
    expect(Number(st!.light_bill_total)).toBe(500);
    expect(Number(st!.net_balance)).toBe(4500);
  });
});
