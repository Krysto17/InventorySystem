import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 10 (B): Auditor → Manager → Owner draft chain. Nothing an auditor does
// takes effect until a manager/owner approves; an author can never review
// their own draft.
describe("auditor_drafts RLS + apply chain", () => {
  let siteAId: string, siteBId: string;
  let aud: TestUser, audB: TestUser, mgr: TestUser, recv: TestUser, owner: TestUser;
  let supplierId: string;

  async function draftAdvance(amount: number) {
    const { data, error } = await aud.client.from("auditor_drafts").insert({
      site_id: siteAId,
      kind: "advance",
      payload: { supplier_id: supplierId, purpose: "Audit advance", amount_naira: amount },
      created_by: aud.userId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    aud   = await makeUser({ username: "ad-aud-a", role: "auditor",   siteId: siteAId });
    audB  = await makeUser({ username: "ad-aud-b", role: "auditor",   siteId: siteBId });
    mgr   = await makeUser({ username: "ad-mgr-a", role: "manager",   siteId: siteAId });
    recv  = await makeUser({ username: "ad-recv-a", role: "receiving", siteId: siteAId });
    owner = await makeUser({ username: "ad-owner", role: "owner",     siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Draft Supplier" }).select("id").single();
    supplierId = s!.id as string;
  });

  it("auditor creates a draft on own site; cross-site insert denied", async () => {
    const id = await draftAdvance(5000);
    expect(id).toBeTruthy();
    const { error } = await aud.client.from("auditor_drafts").insert({
      site_id: siteBId, kind: "advance",
      payload: { supplier_id: supplierId, purpose: "x", amount_naira: 1 },
      created_by: aud.userId,
    });
    expect(error).not.toBeNull();
  });

  it("non-auditor roles cannot create drafts", async () => {
    const { error } = await recv.client.from("auditor_drafts").insert({
      site_id: siteAId, kind: "expense",
      payload: { name: "x", category: "others" },
      created_by: recv.userId,
    });
    expect(error).not.toBeNull();
  });

  it("a draft has no effect until approved; manager approval applies it", async () => {
    const id = await draftAdvance(7777);
    const before = await adminClient().from("advances").select("id").eq("amount_naira", 7777);
    expect(before.data ?? []).toHaveLength(0);

    // Auditor submits
    const { error: sErr } = await aud.client.from("auditor_drafts")
      .update({ review_status: "submitted" }).eq("id", id);
    expect(sErr).toBeNull();

    // Manager approves → the advance row materializes (pending owner approval)
    const { error: aErr } = await mgr.client.from("auditor_drafts")
      .update({ review_status: "approved" }).eq("id", id);
    expect(aErr).toBeNull();
    const after = await adminClient().from("advances")
      .select("approval_status, recorded_by").eq("amount_naira", 7777).single();
    expect(after.data!.approval_status).toBe("pending");
    expect(after.data!.recorded_by).toBe(aud.userId);
  });

  it("an auditor cannot approve their own draft", async () => {
    const id = await draftAdvance(8888);
    await aud.client.from("auditor_drafts").update({ review_status: "submitted" }).eq("id", id);
    const { error } = await aud.client.from("auditor_drafts")
      .update({ review_status: "approved" }).eq("id", id);
    expect(error).not.toBeNull();
    const { data } = await adminClient().from("auditor_drafts").select("review_status").eq("id", id).single();
    expect(data!.review_status).toBe("submitted");
  });

  it("a draft cannot jump straight to approved without being submitted", async () => {
    const id = await draftAdvance(9999);
    const { error } = await mgr.client.from("auditor_drafts")
      .update({ review_status: "approved" }).eq("id", id);
    expect(error).not.toBeNull();
  });

  it("rejected drafts apply nothing and become immutable", async () => {
    const id = await draftAdvance(6543);
    await aud.client.from("auditor_drafts").update({ review_status: "submitted" }).eq("id", id);
    await mgr.client.from("auditor_drafts").update({ review_status: "rejected" }).eq("id", id);
    const adv = await adminClient().from("advances").select("id").eq("amount_naira", 6543);
    expect(adv.data ?? []).toHaveLength(0);
    const { error } = await aud.client.from("auditor_drafts")
      .update({ review_status: "submitted" }).eq("id", id);
    expect(error).not.toBeNull();
  });

  it("approved line_price draft sets the line price", async () => {
    // Seed a visit in pricing with one line
    const { data: m } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteAId, supplier_id: supplierId, declared_material_type_id: m!.id,
      entry_path: "pre_processed", state: "in_receiving", created_by: mgr.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: m!.id, weight_kg: 10, recorded_by: mgr.userId,
    }).select("id").single();

    const { data: d } = await aud.client.from("auditor_drafts").insert({
      site_id: siteAId, kind: "line_price",
      payload: { visit_material_id: line!.id, unit_price: 321 },
      created_by: aud.userId,
    }).select("id").single();
    await aud.client.from("auditor_drafts").update({ review_status: "submitted" }).eq("id", d!.id);
    await mgr.client.from("auditor_drafts").update({ review_status: "approved" }).eq("id", d!.id);

    const { data: priced } = await adminClient().from("visit_materials")
      .select("unit_price, purchase_amount, priced_by").eq("id", line!.id).single();
    expect(Number(priced!.unit_price)).toBe(321);
    expect(Number(priced!.purchase_amount)).toBe(3210);
    expect(priced!.priced_by).toBe(mgr.userId); // reviewer owns the applied price
  });

  it("auditor at site B cannot read site A drafts", async () => {
    const id = await draftAdvance(1212);
    const { data } = await audB.client.from("auditor_drafts").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });
});
