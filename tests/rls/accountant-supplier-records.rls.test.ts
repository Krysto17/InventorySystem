import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The accountant can read a supplier's full record (visits/supplies, advances,
// stock lots) and outstanding debt — even for another site (cross-site read).
describe("accountant reads supplier records", () => {
  let siteId: string, monaziteId: string, supplierId: string;
  let acct: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const other = sites!.find((s) => s.name !== "New-Site")!;
    siteId = other.id as string;
    const newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    acct = await makeUser({ username: "asr-acct", role: "accounting", siteId: newSite }); // different site
    recv = await makeUser({ username: "asr-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `ASR ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;

    // Seed a visit and an advance at the other site.
    await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    });
    await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "float", amount_naira: 1000,
      approval_status: "paid", recorded_by: recv.userId,
    });
  });

  it("reads the supplier's visits (supplies), advances and debt cross-site", async () => {
    const visits = await acct.client.from("visits").select("id").eq("supplier_id", supplierId);
    expect(visits.data ?? []).not.toHaveLength(0);

    const advances = await acct.client.from("advances").select("id, amount_naira").eq("supplier_id", supplierId);
    expect(advances.data ?? []).not.toHaveLength(0);

    const { data: debt, error } = await acct.client.rpc("supplier_outstanding_debt", { _supplier_id: supplierId });
    expect(error).toBeNull();
    expect(Number(debt)).toBe(1000);
  });
});
