import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A site manager can remove an advance deduction applied by mistake; the
// supplier's outstanding debt is restored. A manager at another site cannot.
describe("manager removes an advance deduction", () => {
  let siteA: string, siteB: string;
  let mgrA: TestUser, mgrB: TestUser;
  let supplierId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    // Two NON-New-Site sites so both are plain site managers (the New-Site
    // manager is the general manager and can delete cross-site).
    const plain = sites!.filter((s) => s.name !== "New-Site");
    siteA = plain[0].id as string;
    siteB = plain[1].id as string;
    mgrA = await makeUser({ username: "rd-mgrA", role: "manager", siteId: siteA });
    mgrB = await makeUser({ username: "rd-mgrB", role: "manager", siteId: siteB });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `RD ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    // A paid advance = ₦50k debt.
    await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteA, purpose: "float", amount_naira: 50000,
      approval_status: "paid", recorded_by: mgrA.userId,
    });
  });

  async function newDeduction() {
    const { data } = await adminClient().from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteA, amount: 20000, recorded_by: mgrA.userId,
    }).select("id").single();
    return data!.id as string;
  }

  it("own-site manager removes the deduction → debt restored", async () => {
    const id = await newDeduction();
    let { data: debt } = await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId });
    expect(Number(debt)).toBe(30000); // 50k - 20k
    const { error } = await mgrA.client.from("advance_deductions").delete().eq("id", id);
    expect(error).toBeNull();
    ({ data: debt } = await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId }));
    expect(Number(debt)).toBe(50000); // restored
  });

  it("a different-site manager cannot remove the deduction", async () => {
    const id = await newDeduction();
    await mgrB.client.from("advance_deductions").delete().eq("id", id); // mgrB is at New-Site, deduction at siteA
    const { data } = await adminClient().from("advance_deductions").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(1); // still there
    await adminClient().from("advance_deductions").delete().eq("id", id);
  });
});
