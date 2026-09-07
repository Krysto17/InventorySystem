import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient } from "../setup/supabase-test-clients";

/**
 * A paid material must be reachable on the Cost Price screen.
 *
 * A stock lot exists only because a settlement reached `paid` — the trigger
 * _batch_settlements_stock_on_paid creates it in that same transaction. So the
 * newest available lot is always the most recently paid material, and it is the
 * one an operator has come to the screen to mix.
 *
 * The lot list asked for `order(created_at asc).limit(300)`: the OLDEST 300. Once
 * a site passes 300 available lots the newest ones fall off the end, with no
 * pagination and no indication — measured in production at 483 available lots,
 * 183 of them (every lot paid between 2026-08-27 and 2026-09-04) unreachable.
 *
 * Two things are tested, at the level each actually lives at:
 *
 *   1. the query semantics, against the database — oldest-first truncation drops
 *      a newly paid lot, newest-first + limit+1 keeps it and reports there is more;
 *   2. that CostPriceModule really uses that shape, and does not render a failed
 *      query as "no stock lots" — read from its source, because this harness
 *      cannot render a server component (it reaches for next/headers).
 */

const SOURCE = new URL("../../src/components/reports/CostPriceModule.tsx", import.meta.url);
const source = () => readFileSync(SOURCE, "utf8");

describe("cost price — a paid lot stays reachable", () => {
  // ── 1. Query semantics, against a real table over the 300 boundary ───────
  describe("the lot window over more than one page of lots", () => {
    const PAGE = 300;
    let siteId: string, materialTypeId: string, newestId: string;
    // A cost per kg no other fixture uses: it scopes every query and the
    // cleanup to exactly the lots this test created.
    const MARKER = 100.55;

    beforeAll(async () => {
      const admin = adminClient();
      // Deliberately NOT a site of our own: several suites pick a site with
      // `sites.find(s => s.name !== "New-Site")`, so an extra row changes which
      // site they get. These lots live on an existing site and are identified by
      // a cost marker no other fixture uses, so every query below — and the
      // cleanup — sees only ours.
      const { data: sites } = await admin.from("sites").select("id, name");
      siteId = sites!.find((s) => s.name === "Dong")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").limit(1).single();
      materialTypeId = mt!.id as string;
      await admin.from("stock_lots").delete().eq("cost_price_per_kg", MARKER);

      // 305 available lots, oldest first, so the last one written is the newest.
      const base = Date.parse("2026-01-01T00:00:00Z");
      const rows = Array.from({ length: PAGE + 5 }, (_, i) => ({
        site_id: siteId, material_type_id: materialTypeId, weight_kg: 10,
        cost_price_per_kg: MARKER, status: "available",
        created_at: new Date(base + i * 60_000).toISOString(),
      }));
      const { error } = await admin.from("stock_lots").insert(rows);
      expect(error, `lot fixture: ${error?.message}`).toBeNull();

      const { data: newest } = await admin.from("stock_lots")
        .select("id").eq("cost_price_per_kg", MARKER).eq("status", "available")
        .order("created_at", { ascending: false }).limit(1).single();
      newestId = newest!.id as string;
    });

    afterAll(async () => {
      await adminClient().from("stock_lots").delete().eq("cost_price_per_kg", MARKER);
    });

    it("oldest-first + limit(300) drops the most recently paid lot — the defect", async () => {
      const { data } = await adminClient().from("stock_lots")
        .select("id").eq("cost_price_per_kg", MARKER).eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(PAGE);
      expect(data).toHaveLength(PAGE);
      expect(
        (data ?? []).some((r) => r.id === newestId),
        "the newest paid lot is absent from the oldest-300 window",
      ).toBe(false);
    });

    it("newest-first keeps the most recently paid lot in the first page", async () => {
      const { data } = await adminClient().from("stock_lots")
        .select("id").eq("cost_price_per_kg", MARKER).eq("status", "available")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE + 1);
      const rows = (data ?? []).slice(0, PAGE);
      expect(rows.some((r) => r.id === newestId), "the newest paid lot must be shown").toBe(true);
    });

    it("asking for one extra row is what reveals there are more", async () => {
      const { data } = await adminClient().from("stock_lots")
        .select("id").eq("cost_price_per_kg", MARKER).eq("status", "available")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE + 1);
      expect((data ?? []).length > PAGE, "hasMore must be derivable without a count").toBe(true);
    });
  });

  // ── 2. The module actually uses that shape ──────────────────────────────
  describe("CostPriceModule", () => {
    it("orders the lot list newest-first, so a newly paid lot is never the one cut", () => {
      const lotQuery = source().split('.from("cost_price_runs")')[0];
      expect(lotQuery, "lot list must not be ordered oldest-first").not.toMatch(
        /created_at",\s*\{\s*ascending:\s*true/,
      );
      expect(lotQuery).toMatch(/created_at",\s*\{\s*ascending:\s*false/);
    });

    it("asks for one row more than it shows, instead of silently capping", () => {
      const s = source();
      expect(s, "the lot list must fetch limit + 1").toMatch(/\.limit\(\s*\w+\s*\+\s*1\s*\)/);
      expect(s, "it must derive hasMore from that extra row").toMatch(/hasMore/);
    });

    it("tells the operator when there are more lots than it is showing", () => {
      // A silent cap is the defect; the count in the UI must be honest about it.
      expect(source()).toMatch(/hasMore\s*&&|hasMore\s*\?/);
    });

    it("does not render a failed query as 'no stock lots'", () => {
      const s = source();
      expect(s, "the lot query error must be read").toMatch(/error:\s*lotsError|lotsError/);
      // JSX escapes the apostrophe, so accept either spelling.
      expect(s, "a read failure must be distinguishable from an empty result")
        .toMatch(/couldn(&apos;|')t load|could not load|failed to load/i);
    });
  });
});
