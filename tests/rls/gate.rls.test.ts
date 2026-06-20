import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Gate role: Phase 1/2 pipeline intake + gate passes (manager/owner issue → gate
// acknowledge) + movement log. Acknowledging a lot-backed pass removes the lot
// from stock via a 'gate_release' stock movement.
describe("gate intake + passes + stock release RLS", () => {
  // Unique per-run suffix: this suite runs against a non-reset local DB, so
  // fixed usernames would collide with leftover users from a previous run.
  const rid = Date.now().toString(36);
  let siteAId: string, siteBId: string, materialId: string, supplierId: string;
  let mgrA: TestUser, gateA: TestUser, gateB: TestUser, invA: TestUser, owner: TestUser;

  async function issuePass(siteId: string, issuedBy: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await adminClient()
      .from("gate_passes")
      .insert({ site_id: siteId, reason: "Outgoing concentrate", issued_by: issuedBy, ...extra })
      .select("id, pass_code, status")
      .single();
    if (error) throw error;
    return data!;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    const { data: mat } = await adminClient().from("material_types").select("id").limit(1).single();
    materialId = mat!.id as string;
    const { data: sup } = await adminClient()
      .from("suppliers").insert({ name: "Gate Supplier", phone: "0700" }).select("id").single();
    supplierId = sup!.id as string;

    mgrA  = await makeUser({ username: `gi-mgr-a-${rid}`,  role: "manager",   siteId: siteAId });
    gateA = await makeUser({ username: `gi-gate-a-${rid}`, role: "gate",      siteId: siteAId });
    gateB = await makeUser({ username: `gi-gate-b-${rid}`, role: "gate",      siteId: siteBId });
    invA  = await makeUser({ username: `gi-inv-a-${rid}`,  role: "inventory", siteId: siteAId });
    owner = await makeUser({ username: `gi-owner-${rid}`,  role: "owner",     siteId: null });
  });

  // ── Intake belongs to processing, not the gate ──────────────────────────────
  it("gate cannot create a visit (intake is the processing role's job)", async () => {
    const { error } = await gateA.client.from("visits").insert({
      site_id: siteAId,
      supplier_id: supplierId,
      declared_material_type_id: materialId,
      entry_path: "unprocessed",
      state: "in_processing",
      created_by: gateA.userId,
    });
    expect(error).not.toBeNull();
  });

  // ── Gate passes ─────────────────────────────────────────────────────────────
  it("auto-generates a GP- pass code on insert", async () => {
    const pass = await issuePass(siteAId, mgrA.userId);
    expect(pass.pass_code as string).toMatch(/^GP-[A-Z]{1,3}-\d{4}$/);
    expect(pass.status).toBe("issued");
  });

  it("manager issues a pass; gate cannot issue", async () => {
    const ok = await mgrA.client.from("gate_passes").insert({
      site_id: siteAId, reason: "Release to buyer", issued_by: mgrA.userId,
    });
    expect(ok.error).toBeNull();

    const bad = await gateA.client.from("gate_passes").insert({
      site_id: siteAId, reason: "Gate should not issue", issued_by: gateA.userId,
    });
    expect(bad.error).not.toBeNull();
  });

  it("gate at site A acknowledges an issued pass; gate at site B cannot", async () => {
    const pass = await issuePass(siteAId, mgrA.userId);
    await gateB.client.from("gate_passes").update({ status: "acknowledged" }).eq("id", pass.id);
    const { data: stillIssued } = await adminClient()
      .from("gate_passes").select("status").eq("id", pass.id).single();
    expect(stillIssued!.status).toBe("issued");

    const { error } = await gateA.client
      .from("gate_passes").update({ status: "acknowledged" }).eq("id", pass.id);
    expect(error).toBeNull();
    const { data } = await adminClient()
      .from("gate_passes").select("status, acknowledged_at").eq("id", pass.id).single();
    expect(data!.status).toBe("acknowledged");
    expect(data!.acknowledged_at).not.toBeNull();
  });

  it("manager can cancel an issued pass; gate cannot cancel", async () => {
    const pass = await issuePass(siteAId, mgrA.userId);
    const gateTry = await gateA.client
      .from("gate_passes").update({ status: "cancelled" }).eq("id", pass.id);
    expect(gateTry.error).not.toBeNull();

    const { error } = await mgrA.client
      .from("gate_passes").update({ status: "cancelled" }).eq("id", pass.id);
    expect(error).toBeNull();
  });

  // ── Stock release on acknowledgement ────────────────────────────────────────
  it("acknowledging a lot-backed pass writes a gate_release 'out' movement", async () => {
    // Seed an available lot + its 'in' movement so there's stock to release.
    const { data: lot } = await adminClient().from("stock_lots").insert({
      site_id: siteAId, material_type_id: materialId, supplier_id: supplierId,
      weight_kg: 100, cost_price_per_kg: 50, recorded_by: owner.userId,
    }).select("id").single();
    await adminClient().from("stock_movements").insert({
      site_id: siteAId, material_type_id: materialId, weight: 100,
      direction: "in", recorded_by: owner.userId, reason: "purchase_intake",
    });

    const pass = await issuePass(siteAId, mgrA.userId, { stock_lot_id: lot!.id, weight_kg: 40 });
    const { error } = await gateA.client
      .from("gate_passes").update({ status: "acknowledged" }).eq("id", pass.id);
    expect(error).toBeNull();

    const { data: outRows } = await adminClient()
      .from("stock_movements")
      .select("weight, direction, reason")
      .eq("site_id", siteAId).eq("material_type_id", materialId).eq("reason", "gate_release");
    expect((outRows ?? []).some((r) => Number(r.weight) === 40 && r.direction === "out")).toBe(true);
  });

  it("gate at site A logs a movement; inventory cannot", async () => {
    const { error: gateErr } = await gateA.client.from("gate_logs").insert({
      site_id: siteAId, direction: "in", driver_name: "Sani", bags: 12, recorded_by: gateA.userId,
    });
    expect(gateErr).toBeNull();

    const { error: invErr } = await invA.client.from("gate_logs").insert({
      site_id: siteAId, direction: "in", recorded_by: invA.userId,
    });
    expect(invErr).not.toBeNull();
  });

  it("owner reads passes across sites; manager has cross-site read of gate logs", async () => {
    const pass = await issuePass(siteBId, owner.userId);
    const { data: p } = await owner.client.from("gate_passes").select("id").eq("id", pass.id);
    expect(p ?? []).toHaveLength(1);

    const { data: row } = await adminClient().from("gate_logs").insert({
      site_id: siteBId, direction: "out", recorded_by: owner.userId,
    }).select("id").single();
    const { data: l } = await mgrA.client.from("gate_logs").select("id").eq("id", row!.id);
    expect(l ?? []).toHaveLength(1);
  });

  // ── No-agreement gate exit (manager OR owner authorises → gate releases) ─────
  async function awaitingExitVisit(siteId: string) {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialId,
      entry_path: "unprocessed", state: "awaiting_gate_exit", created_by: owner.userId,
    }).select("id").single();
    return data!.id as string;
  }

  it("gate cannot release before authorisation; manager authorises; then gate releases", async () => {
    const visitId = await awaitingExitVisit(siteAId);

    const early = await gateA.client.from("visits").update({ state: "exited" }).eq("id", visitId);
    expect(early.error).not.toBeNull(); // blocked: no authorisation yet

    const invTry = await invA.client.from("gate_exit_authorizations")
      .insert({ visit_id: visitId, authorized_by: invA.userId });
    expect(invTry.error).not.toBeNull(); // inventory cannot authorise

    const mgrOk = await mgrA.client.from("gate_exit_authorizations")
      .insert({ visit_id: visitId, authorized_by: mgrA.userId });
    expect(mgrOk.error).toBeNull(); // manager (own site) authorises

    const rel = await gateA.client.from("visits").update({ state: "exited" }).eq("id", visitId);
    expect(rel.error).toBeNull();
    const { data: after } = await adminClient()
      .from("visits").select("state, closed_at").eq("id", visitId).single();
    expect(after!.state).toBe("exited");
    expect(after!.closed_at).not.toBeNull();
  });

  it("owner can authorise a no-agreement exit on any site", async () => {
    const visitId = await awaitingExitVisit(siteBId);
    const { error } = await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: visitId, authorized_by: owner.userId });
    expect(error).toBeNull();
  });
});
