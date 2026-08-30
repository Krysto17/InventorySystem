import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, anonClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { DELETE_BATCH_ROLES } from "../../src/lib/auth/roles";

/**
 * Who may delete a batch — proved against the authority, not the button.
 *
 * F-1: the server action gated on owner/manager while the UI offered the button
 * to processing and receiving too, and delete_batch (0142) accepted all four.
 * The action now defers to DELETE_BATCH_ROLES; this file proves that list is the
 * same set the database actually honours, so the two cannot drift apart
 * unnoticed.
 *
 * The conditions each role is subject to (site, state, settlement) are covered
 * by tests/rls/manager-delete-receiving-unsettle and
 * tests/rls/receiving-delete-and-gate-pass. What is asserted here is only the
 * question the server action itself answers: does this role have any path at all?
 */
describe("delete_batch role gate", () => {
  let siteId: string, supplierId: string, materialId: string;
  const users: Record<string, TestUser> = {};

  // A brand-new visit still in processing: the earliest state, which every role
  // with a delete path is allowed to remove. Anything refused here is refused
  // for the role, not for the batch's condition.
  const freshVisit = async () => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialId,
      entry_path: "unprocessed", state: "in_processing", created_by: users.owner.userId,
    }).select("id").single();
    return data!.id as string;
  };
  const stillThere = async (id: string) =>
    (await adminClient().from("visits").select("id").eq("id", id).maybeSingle()).data != null;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;

    for (const role of ["owner", "manager", "processing", "receiving", "accounting", "qc"] as const) {
      users[role] = await makeUser({
        username: `dbg-${role}`,
        role,
        siteId: role === "owner" ? null : siteId,
      });
    }

    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `DBG ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `DBG-Ore ${Date.now()}` }).select("id").single();
    materialId = mt!.id as string;
  });

  for (const role of ["owner", "manager", "processing", "receiving"] as const) {
    it(`${role} may delete a batch`, async () => {
      const v = await freshVisit();
      const { error } = await users[role].client.rpc("delete_batch", { p_visit_id: v });
      expect(error, `${role} was refused: ${error?.message}`).toBeNull();
      expect(await stillThere(v)).toBe(false);
    });
  }

  for (const role of ["accounting", "qc"] as const) {
    it(`${role} may not — an unrelated role is refused and the batch survives`, async () => {
      const v = await freshVisit();
      const { error } = await users[role].client.rpc("delete_batch", { p_visit_id: v });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not authorized/i);
      expect(await stillThere(v)).toBe(true);
    });
  }

  it("an unauthenticated caller is refused", async () => {
    const v = await freshVisit();
    const { error } = await anonClient().rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(await stillThere(v)).toBe(true);
  });

  // ── The state conditions, which is why the action must NOT restate them ────
  // Having a delete path is not the same as being allowed to delete this batch
  // now. The RPC decides that, in the same transaction as the delete; these
  // prove it still refuses when the business state says no.
  const settle = async (visitId: string, status: string) =>
    adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId, materials_total: 5000, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 5000,
      submitted_by: users.manager.userId, status,
    });

  it("processing may not delete once the batch has moved past processing", async () => {
    const v = await freshVisit();
    await adminClient().from("visits").update({ state: "in_receiving" }).eq("id", v);
    const { error } = await users.processing.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/still in processing/i);
    expect(await stillThere(v)).toBe(true);
  });

  it("receiving may not delete once a settlement exists — money is involved", async () => {
    const v = await freshVisit();
    await adminClient().from("visits").update({ state: "in_accounting" }).eq("id", v);
    await settle(v, "approved");
    const { error } = await users.receiving.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(await stillThere(v)).toBe(true);
  });

  it("a manager may not delete a batch the owner has already approved", async () => {
    const v = await freshVisit();
    await settle(v, "approved");
    const { error } = await users.manager.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already approved/i);
    expect(await stillThere(v)).toBe(true);
  });

  it("not even the owner may delete a batch that has been paid", async () => {
    const v = await freshVisit();
    await settle(v, "paid");
    const { error } = await users.owner.client.rpc("delete_batch", { p_visit_id: v });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/has been paid/i);
    expect(await stillThere(v)).toBe(true);
  });

  it("the app's role list is exactly the set the database honours", () => {
    expect([...DELETE_BATCH_ROLES].sort())
      .toEqual(["manager", "owner", "processing", "receiving"]);
  });
});
