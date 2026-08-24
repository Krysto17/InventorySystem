import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Site managers remove a mistaken batch on their own site until the owner
// approves it; receiving pulls a failing material out, but the gate pass it
// raises still needs a manager's signature.
describe("site-manager delete + receiving unsettle", () => {
  let siteA: string, siteB: string, supplierId: string, material: string;
  let mgrA: TestUser, mgrB: TestUser, recv: TestUser, recvB: TestUser, owner: TestUser;

  const visit = async (state = "pricing") => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteA, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state, created_by: recv.userId,
    }).select("id").single();
    return data!.id as string;
  };
  const line = async (visitId: string) => {
    const { data } = await adminClient().from("visit_materials")
      .insert({ visit_id: visitId, material_type_id: material, weight_kg: 40, unit_price: 100 })
      .select("id").single();
    return data!.id as string;
  };
  const settle = async (visitId: string, status: string) =>
    adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteA, materials_total: 4000, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 4000,
      submitted_by: recv.userId, status,
    });
  const exists = async (visitId: string) =>
    (await adminClient().from("visits").select("id").eq("id", visitId).maybeSingle()).data != null;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site" && s.id !== siteA)!.id as string;
    mgrA = await makeUser({ username: "md-mgr-a", role: "manager", siteId: siteA });
    mgrB = await makeUser({ username: "md-mgr-b", role: "manager", siteId: siteB });
    recv = await makeUser({ username: "md-recv", role: "receiving", siteId: siteA });
    recvB = await makeUser({ username: "md-recv-b", role: "receiving", siteId: siteB });
    owner = await makeUser({ username: "md-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `MD ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `MD-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
  });

  // ── Any site manager deletes, up to the owner's approval ──────────────────
  it("a site manager deletes a batch on their own site", async () => {
    const v = await visit();
    expect((await mgrA.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("still deletes one that has a settlement pending approval", async () => {
    const v = await visit("in_accounting");
    await settle(v, "pending");
    expect((await mgrA.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("cannot delete once the owner has approved it", async () => {
    const v = await visit("in_accounting");
    await settle(v, "approved");
    expect((await mgrA.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("cannot delete a batch on another site", async () => {
    const v = await visit();
    expect((await mgrB.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  // ── Receiving unsettles, but does not authorise the exit ──────────────────
  it("receiving unsettles a line, and the gate pass waits for a manager", async () => {
    const v = await visit("in_qc");
    const l = await line(v);
    expect((await recv.client.rpc("unsettle_line", {
      p_line_id: l, p_reason: "Wet, off spec",
    })).error).toBeNull();

    const { data: vm } = await adminClient().from("visit_materials")
      .select("settlement_status, unsettled_reason").eq("id", l).single();
    expect(vm!.settlement_status).toBe("unsettled");
    expect(vm!.unsettled_reason).toBe("Wet, off spec");

    const { data: gp } = await adminClient().from("gate_passes")
      .select("status, requested_by, authorized_by").eq("visit_material_id", l).single();
    expect(gp!.status).toBe("pending");            // NOT issued by receiving
    expect(gp!.requested_by).toBe(recv.userId);
    expect(gp!.authorized_by).toBeNull();

    // A manager signs it off, exactly as for any other pass receiving raises.
    const { data: passId } = await adminClient().from("gate_passes")
      .select("id").eq("visit_material_id", l).single();
    expect((await mgrA.client.rpc("authorize_gate_pass", { p_pass_id: passId!.id })).error).toBeNull();
    const { data: after } = await adminClient().from("gate_passes")
      .select("status, authorized_by").eq("id", passId!.id).single();
    expect(after!.status).toBe("issued");
    expect(after!.authorized_by).toBe(mgrA.userId);
  });

  it("a manager's own unsettle still issues the pass directly", async () => {
    const v = await visit("pricing");
    const l = await line(v);
    await mgrA.client.rpc("unsettle_line", { p_line_id: l, p_reason: "No price agreed" });
    const { data: gp } = await adminClient().from("gate_passes")
      .select("status, authorized_by").eq("visit_material_id", l).single();
    expect(gp!.status).toBe("issued");
    expect(gp!.authorized_by).toBe(mgrA.userId);
  });

  it("receiving cannot unsettle once the batch has a settlement", async () => {
    const v = await visit("in_accounting");
    const l = await line(v);
    await settle(v, "pending");
    expect((await recv.client.rpc("unsettle_line", { p_line_id: l })).error).not.toBeNull();
    const { data: vm } = await adminClient().from("visit_materials")
      .select("settlement_status").eq("id", l).single();
    expect(vm!.settlement_status).toBe("settled");
  });

  it("receiving cannot unsettle another site's material", async () => {
    const v = await visit("in_qc");
    const l = await line(v);
    expect((await recvB.client.rpc("unsettle_line", { p_line_id: l })).error).not.toBeNull();
  });

  it("putting a line back is still the manager's call", async () => {
    const v = await visit("in_qc");
    const l = await line(v);
    await recv.client.rpc("unsettle_line", { p_line_id: l, p_reason: "off spec" });
    expect((await recv.client.rpc("resettle_line", { p_line_id: l })).error).not.toBeNull();
    expect((await mgrA.client.rpc("resettle_line", { p_line_id: l })).error).toBeNull();
  });

  it("the owner is unaffected by any of it", async () => {
    const v = await visit("in_accounting");
    await settle(v, "approved");
    expect((await owner.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
  });
});
