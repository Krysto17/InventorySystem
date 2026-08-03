import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Receiving may remove a whole visit they created (until money or stock has
// moved), and may raise a gate pass that carries no authority until a manager
// authorizes it.
describe("receiving: delete a whole visit + request a gate pass", () => {
  let siteId: string, otherSite: string, monazite: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, recv: TestUser, recvOther: TestUser, qc: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    owner = await makeUser({ username: "rg-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "rg-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "rg-recv", role: "receiving", siteId });
    recvOther = await makeUser({ username: "rg-recv2", role: "receiving", siteId: otherSite });
    qc = await makeUser({ username: "rg-qc", role: "qc", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `RG ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  const visit = async (state: string) => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state, created_by: recv.userId,
    }).select("id").single();
    return data!.id as string;
  };
  const exists = async (id: string) =>
    (await adminClient().from("visits").select("id").eq("id", id).maybeSingle()).data != null;

  // ── Deleting a whole visit ────────────────────────────────────────────────
  it("receiving deletes a visit that has moved on to QC", async () => {
    const v = await visit("in_qc");
    expect((await recv.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("receiving deletes a visit that has reached pricing", async () => {
    const v = await visit("pricing");
    expect((await recv.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect(await exists(v)).toBe(false);
  });

  it("blocked once a settlement exists (money involved)", async () => {
    const v = await visit("in_accounting");
    await adminClient().from("batch_settlements").insert({
      visit_id: v, site_id: siteId, materials_total: 5000, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 5000, submitted_by: recv.userId, status: "approved",
    });
    expect((await recv.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("blocked once stocked", async () => {
    const v = await visit("stocked");
    expect((await recv.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  it("receiving on another site cannot delete it", async () => {
    const v = await visit("in_receiving");
    expect((await recvOther.client.rpc("delete_batch", { p_visit_id: v })).error).not.toBeNull();
    expect(await exists(v)).toBe(true);
  });

  // ── Gate pass: raised by receiving, authorized by the manager ─────────────
  const raise = async (as: TestUser, status = "pending") =>
    as.client.from("gate_passes").insert({
      site_id: siteId, supplier_id: supplierId, material_type_id: monazite,
      weight_kg: 25, reason: "Returned to owner", status,
      issued_by: as.userId, requested_by: as.userId,
    }).select("id").single();

  it("receiving raises a PENDING pass; the manager authorizes it", async () => {
    const { data, error } = await raise(recv);
    expect(error).toBeNull();
    const id = data!.id as string;
    expect((await adminClient().from("gate_passes").select("status").eq("id", id).single()).data!.status).toBe("pending");

    expect((await mgr.client.rpc("authorize_gate_pass", { p_pass_id: id })).error).toBeNull();
    const row = (await adminClient().from("gate_passes").select("status, authorized_by, authorized_at").eq("id", id).single()).data!;
    expect(row.status).toBe("issued");
    expect(row.authorized_by).toBe(mgr.userId);
    expect(row.authorized_at).not.toBeNull();
  });

  it("receiving cannot self-authorize by raising it as issued", async () => {
    const { error } = await raise(recv, "issued");
    expect(error).not.toBeNull();
  });

  it("receiving cannot authorize a pending pass", async () => {
    const { data } = await raise(recv);
    const id = data!.id as string;
    expect((await recv.client.rpc("authorize_gate_pass", { p_pass_id: id })).error).not.toBeNull();
    expect((await adminClient().from("gate_passes").select("status").eq("id", id).single()).data!.status).toBe("pending");
  });

  it("an already-issued pass cannot be authorized twice", async () => {
    const { data } = await raise(recv);
    const id = data!.id as string;
    await mgr.client.rpc("authorize_gate_pass", { p_pass_id: id });
    expect((await mgr.client.rpc("authorize_gate_pass", { p_pass_id: id })).error).not.toBeNull();
  });

  it("QC cannot raise a gate pass", async () => {
    const { error } = await raise(qc);
    expect(error).not.toBeNull();
  });
});
