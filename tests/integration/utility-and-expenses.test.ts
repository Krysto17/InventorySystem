import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 11 (B+E): utility charges per visit + the expense approval flow.
describe("utility charges + expense approval", () => {
  let siteAId: string, siteBId: string;
  let proc: TestUser, mgr: TestUser, inv: TestUser, recv: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newVisit(state = "in_processing"): Promise<string> {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteAId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "unprocessed", state, created_by: proc.userId,
    }).select("id").single();
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    proc  = await makeUser({ username: "utl-proc", role: "processing", siteId: siteAId });
    mgr   = await makeUser({ username: "utl-mgr",  role: "manager",    siteId: siteAId });
    inv   = await makeUser({ username: "utl-inv",  role: "inventory",  siteId: siteAId });
    recv  = await makeUser({ username: "utl-recv", role: "receiving",  siteId: siteAId });
    owner = await makeUser({ username: "utl-owner", role: "owner",     siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Utility Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  // ── Utility charges ──────────────────────────────────────────────────────

  it("processing records a light bill on an open visit; audit event written", async () => {
    const vid = await newVisit();
    const { error } = await proc.client.from("utility_charges").insert({
      visit_id: vid, kind: "light_bill", description: "NEPA bill share",
      amount: 4500, recorded_by: proc.userId,
    });
    expect(error).toBeNull();

    const { data: events } = await adminClient()
      .from("transaction_events").select("payload").eq("visit_id", vid);
    expect(events!.some((e) => (e.payload as { table?: string }).table === "utility_charges")).toBe(true);
  });

  it("manager can add a utility charge; receiving cannot", async () => {
    const vid = await newVisit();
    const ok = await mgr.client.from("utility_charges").insert({
      visit_id: vid, kind: "other", description: "Water", amount: 1000, recorded_by: mgr.userId,
    });
    expect(ok.error).toBeNull();
    const bad = await recv.client.from("utility_charges").insert({
      visit_id: vid, kind: "other", amount: 10, recorded_by: recv.userId,
    });
    expect(bad.error).not.toBeNull();
  });

  it("utility charges cannot be added to a closed visit", async () => {
    const vid = await newVisit("exited");
    const { error } = await proc.client.from("utility_charges").insert({
      visit_id: vid, kind: "light_bill", amount: 100, recorded_by: proc.userId,
    });
    expect(error).not.toBeNull();
  });

  // ── Expense approval (consumables) ───────────────────────────────────────

  it("manager submits an expense (pending); only the owner can approve", async () => {
    const { data: exp, error } = await mgr.client.from("consumables").insert({
      site_id: siteAId, name: "Generator repair", category: "repairs_maintenance",
      amount_naira: 35000, recorded_by: mgr.userId,
    }).select("id, approval_status").single();
    expect(error).toBeNull();
    expect(exp!.approval_status).toBe("pending");

    // Inventory (who can update consumables) cannot flip the status.
    const tryInv = await inv.client.from("consumables")
      .update({ approval_status: "approved" }).eq("id", exp!.id);
    expect(tryInv.error).not.toBeNull();

    // Owner approves; approved_by/at stamped.
    const ownerOk = await owner.client.from("consumables")
      .update({ approval_status: "approved" }).eq("id", exp!.id);
    expect(ownerOk.error).toBeNull();
    const { data: after } = await adminClient().from("consumables")
      .select("approval_status, approved_by, approved_at").eq("id", exp!.id).single();
    expect(after!.approval_status).toBe("approved");
    expect(after!.approved_by).toBe(owner.userId);
    expect(after!.approved_at).not.toBeNull();
  });

  it("manager cannot submit an expense for another site", async () => {
    const { error } = await mgr.client.from("consumables").insert({
      site_id: siteBId, name: "Cross-site hack", category: "others", recorded_by: mgr.userId,
    });
    expect(error).not.toBeNull();
  });
});
