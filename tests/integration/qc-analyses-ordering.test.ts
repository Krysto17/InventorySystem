import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
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
  const SEEDED = 60; // rows created in beforeAll

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

  it("a full fetch returns every record the analyst owns", async () => {
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

  // ── The +1 probe that replaced the exact count (3C-2) ─────────────────────
  //
  // The page no longer asks how many records exist; it asks for one row more
  // than it shows and treats the arrival of that row as "there is another page".
  // These exercise the boundary at a small page size rather than seeding 201
  // rows — the arithmetic is the same at any limit, and the page's own PAGE_SIZE
  // is a module constant the test cannot inject.
  const pageOf = async (limit: number) => {
    const { data, error } = await qc.client
      .from("xrf_records")
      .select("id")
      .eq("recorded_by", qc.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    expect(error).toBeNull();
    const raw = data ?? [];
    return { rows: raw.slice(0, limit), hasMore: raw.length > limit };
  };

  it("fewer records than the page holds: everything shown, no more to load", async () => {
    const { rows, hasMore } = await pageOf(SEEDED + 40);
    expect(rows).toHaveLength(SEEDED);
    expect(hasMore).toBe(false);
  });

  it("exactly a full page: all shown, and it does NOT claim there is more", async () => {
    const { rows, hasMore } = await pageOf(SEEDED);
    expect(rows).toHaveLength(SEEDED);
    expect(hasMore).toBe(false);
  });

  it("one more than the page: the extra row is consumed, not displayed", async () => {
    const limit = SEEDED - 1;
    const { rows, hasMore } = await pageOf(limit);
    expect(rows).toHaveLength(limit);   // the +1 never reaches the sheet
    expect(hasMore).toBe(true);
  });

  it("a wider page is a strict prefix-superset — nothing skipped or repeated", async () => {
    const small = (await pageOf(20)).rows.map((r) => r.id);
    const wide = (await pageOf(40)).rows.map((r) => r.id);
    expect(wide.slice(0, 20)).toEqual(small);
    expect(new Set(wide).size).toBe(wide.length);
  });

  it("the +1 row is selected in the database, not filtered in the page", async () => {
    // Every row the probe returns carries the analyst's own recorded_by, because
    // the predicate is part of the query rather than applied after the fact.
    //
    // NB this is an APPLICATION scope, not an RLS one: the xrf_records SELECT
    // policy admits any `qc` role to every analysis, so a second analyst reading
    // the table directly does see these rows. The page is what narrows them to
    // one analyst. Pre-existing behaviour, unchanged by the +1 probe — recorded
    // as a finding rather than altered here.
    const { data } = await qc.client
      .from("xrf_records").select("id, recorded_by")
      .eq("recorded_by", qc.userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(21);
    const rows = data ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.recorded_by === qc.userId)).toBe(true);
  });

  // Source-level, because proving "no second query" through the running page
  // would need mocking the Supabase client — brittle for what one grep settles.
  it("the page performs no exact-count query", () => {
    const src = readFileSync(
      new URL("../../src/app/(qc)/qc/analyses/page.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/count:\s*["']exact["']/);
    expect(src).not.toMatch(/head:\s*true/);
    expect(src).toContain("limit + 1");
    // The cap still has to be reported even though the probe cannot see past it.
    expect(src).toContain("atCap");
    expect(src).toMatch(/rows\.length >= MAX_ROWS/);
  });
});
