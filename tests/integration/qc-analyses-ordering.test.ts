import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * The /qc/analyses index (0148) must change how rows are reached, never which
 * rows come back or in what order.
 *
 * An index is only ever an access path, so the risk here is not that it returns
 * something different — it cannot — but that the ordering the page relies on was
 * never total in the first place. It is: created_at DESC, id DESC, made total in
 * 6311339 precisely because analyses are written a batch at a time and share a
 * created_at to the microsecond. These tests pin that contract so a later change
 * to the ORDER BY cannot silently part company with the index that serves it.
 */
describe("qc analyses ordering contract", () => {
  let qc: TestUser, other: TestUser;
  let visitId: string;
  const PAGE = 20;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    qc = await makeUser({ username: `qao-${Date.now()}`, role: "qc", siteId });
    other = await makeUser({ username: `qao2-${Date.now()}`, role: "qc", siteId });

    const { data: sup } = await adminClient().from("suppliers")
      .insert({ name: `QAO ${Date.now()}` }).select("id").single();
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `QAO-Ore ${Date.now()}` }).select("id").single();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: sup!.id, declared_material_type_id: mt!.id,
      entry_path: "processed", state: "in_qc", created_by: qc.userId,
    }).select("id").single();
    visitId = v!.id as string;

    // 60 lines written in one statement, so many share created_at exactly —
    // the tie that makes a single-column sort non-deterministic.
    const lines = Array.from({ length: 60 }, () => ({
      visit_id: visitId, material_type_id: mt!.id, weight_kg: 100,
    }));
    const { data: vms } = await adminClient().from("visit_materials").insert(lines).select("id");
    await adminClient().from("xrf_records").insert(
      vms!.map((l) => ({
        visit_material_id: l.id, result: "Sn 60%", weight_kg: 99,
        submitted: true, recorded_by: qc.userId,
      })),
    );
  });

  const page = (limit: number) =>
    qc.client
      .from("xrf_records")
      .select("id, created_at")
      .eq("recorded_by", qc.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

  it("the analyst sees their own records", async () => {
    const { data, error } = await page(PAGE);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("ordering is total — repeating the query returns the same rows in the same order", async () => {
    const a = (await page(PAGE)).data!.map((r) => r.id);
    const b = (await page(PAGE)).data!.map((r) => r.id);
    expect(a).toEqual(b);
  });

  it("a wider page is a strict superset, in the same order — no row is skipped or repeated", async () => {
    const small = (await page(PAGE)).data!.map((r) => r.id);
    const large = (await page(PAGE * 2)).data!.map((r) => r.id);
    expect(large.slice(0, PAGE)).toEqual(small);
    expect(new Set(large).size).toBe(large.length); // no duplicates
  });

  it("ties on created_at really are present, so the tiebreaker is doing work", async () => {
    const rows = (await page(PAGE * 3)).data!;
    const stamps = rows.map((r) => r.created_at);
    expect(new Set(stamps).size).toBeLessThan(stamps.length);
  });

  it("the count matches what the page reports", async () => {
    const { count } = await qc.client
      .from("xrf_records").select("id", { count: "exact", head: true }).eq("recorded_by", qc.userId);
    const all = (await page(1000)).data!;
    expect(count).toBe(all.length);
  });

  it("another analyst's sheet is scoped to their own work", async () => {
    const { data } = await other.client
      .from("xrf_records").select("id").eq("recorded_by", other.userId);
    expect(data ?? []).toHaveLength(0);
  });
});
