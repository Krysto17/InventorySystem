import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// #4/#5: a batch supply (one visit) can be deleted by the general (New-Site)
// manager while NOT yet owner-approved, and by the owner until it is paid.
// Gate is driven by batch_settlements.status (pending → approved → paid).
describe("delete_batch RPC (#4/#5)", () => {
  let gmSiteId: string, otherSiteId: string;
  let gm: TestUser, siteMgr: TestUser, owner: TestUser;
  let supplierId: string, materialId: string;

  async function newVisit(siteId: string) {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialId,
      entry_path: "processed", state: "in_receiving", created_by: owner.userId,
    }).select("id").single();
    return data!.id as string;
  }

  async function settle(visitId: string, siteId: string, status: string) {
    await adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId, status,
    });
  }

  const exists = async (visitId: string) => {
    const { data } = await adminClient().from("visits").select("id").eq("id", visitId).maybeSingle();
    return data != null;
  };

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    gmSiteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    otherSiteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    gm      = await makeUser({ username: "db-gm",     role: "manager", siteId: gmSiteId });    // general
    siteMgr = await makeUser({ username: "db-sitemgr", role: "manager", siteId: otherSiteId }); // site mgr
    owner   = await makeUser({ username: "db-owner",  role: "owner",   siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "DB Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialId = m!.id as string;
  });

  it("general manager deletes a not-yet-approved batch on ANOTHER site", async () => {
    const v = await newVisit(otherSiteId); // a Dong/Old-Site batch
    const { error } = await gm.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("general manager CANNOT delete an owner-approved batch", async () => {
    const v = await newVisit(otherSiteId);
    await settle(v, otherSiteId, "approved");
    const { error } = await gm.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("a plain SITE manager cannot delete a batch", async () => {
    const v = await newVisit(otherSiteId);
    const { error } = await siteMgr.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("owner deletes an approved-but-unpaid batch", async () => {
    const v = await newVisit(gmSiteId);
    await settle(v, gmSiteId, "approved");
    const { error } = await owner.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("owner CANNOT delete a paid batch", async () => {
    const v = await newVisit(gmSiteId);
    await settle(v, gmSiteId, "paid");
    const { error } = await owner.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("deleting a batch cascades its material lines away", async () => {
    const v = await newVisit(otherSiteId);
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v, material_type_id: materialId, weight_kg: 10, recorded_by: owner.userId,
    }).select("id").single();
    await gm.client.rpc("delete_batch", { p_visit_id: v });
    const { data: gone } = await adminClient()
      .from("visit_materials").select("id").eq("id", line!.id).maybeSingle();
    expect(gone).toBeNull();
  });
});
