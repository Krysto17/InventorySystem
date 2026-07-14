import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Owner-only manual stock adjustment: the owner can record an 'adjustment'
// movement; inventory is limited to 'purchase_intake' by RLS.
describe("stock adjustment (owner only)", () => {
  let siteId: string, monazite: string;
  let owner: TestUser, inv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "sadj-owner", role: "owner", siteId: null });
    inv = await makeUser({ username: "sadj-inv", role: "inventory", siteId });
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  it("owner records an adjustment movement", async () => {
    const { error } = await owner.client.from("stock_movements").insert({
      site_id: siteId, material_type_id: monazite, grade: null, weight: 12.5,
      direction: "in", reason: "adjustment", recorded_by: owner.userId, ref_visit_id: null,
    });
    expect(error).toBeNull();
  });

  it("inventory cannot record an adjustment (RLS: purchase_intake only)", async () => {
    const { error } = await inv.client.from("stock_movements").insert({
      site_id: siteId, material_type_id: monazite, grade: null, weight: 5,
      direction: "out", reason: "adjustment", recorded_by: inv.userId, ref_visit_id: null,
    });
    expect(error).not.toBeNull();
  });
});
