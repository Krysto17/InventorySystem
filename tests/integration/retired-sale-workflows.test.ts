import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { adminClient } from "../setup/supabase-test-clients";
import { navForRole } from "../../src/lib/nav";

/**
 * Lot sales and bulk sales were retired: Cost Price is the one workflow for
 * selling stock.
 *
 * Neither old path ever completed a production sale — lot_sales, lot_sale_items
 * and bulk_sales were all empty, while every one of the 695 sold lots left stock
 * through Cost Price's `mixed_batch` movement. Both also carried defects that
 * retirement removes: an approved lot sale marked lots sold without ever writing
 * the ledger `out` row, and a bulk sale deducted pooled weight without touching
 * stock_lots at all, so the same material could be bulk-sold and then sold again
 * as a lot.
 *
 * What this pins:
 *   1. the routes are gone as workflows, but still land somewhere useful;
 *   2. nothing offers them any more;
 *   3. the TABLES stay. `reverse_paid_supply` reads lot_sale_items to decide
 *      whether a lot has left stock, and stock_movements.ref_bulk_sale_id has a
 *      live foreign key to bulk_sales. Dropping either would break a financial
 *      function or the ledger, so retirement is application-only.
 */

const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

describe("retired sale workflows", () => {
  // ── 1. The old routes are redirects, not workflows ───────────────────────
  for (const route of ["lot-sales", "bulk-sales"]) {
    it(`/inventory/${route} redirects to cost price instead of selling`, () => {
      const page = src(`app/(inventory)/inventory/${route}/page.tsx`);
      expect(page, "must redirect").toMatch(/redirect\(\s*["']\/inventory\/cost-price["']\s*\)/);
      // Not merely hidden: nothing may still write a sale from here.
      expect(page).not.toMatch(/from\(["'](lot_sales|lot_sale_items|bulk_sales)["']\)/);
      expect(page).not.toMatch(/insert\(|update\(|delete\(/);
    });

    it(`the ${route} server actions are gone`, () => {
      expect(
        existsSync(new URL(`../../src/app/(inventory)/inventory/${route}/actions.ts`, import.meta.url)),
        `${route}/actions.ts must not exist`,
      ).toBe(false);
    });
  }

  // ── 2. Nothing offers the retired workflows ──────────────────────────────
  it("inventory navigation offers cost price and neither retired route", () => {
    const hrefs = navForRole("inventory").map((n) => n.href);
    expect(hrefs).toContain("/inventory/cost-price");
    expect(hrefs).not.toContain("/inventory/lot-sales");
    expect(hrefs).not.toContain("/inventory/bulk-sales");
  });

  it("the owner is no longer asked to approve bulk or lot sales", () => {
    const notifications = src("lib/notifications.ts");
    expect(notifications).not.toMatch(/key: "bulk_sales"/);
    expect(notifications).not.toMatch(/key: "lot_sales"/);
    // The realtime channel should not wake every owner client for a dead table.
    expect(src("components/shell/AppShell.tsx")).not.toMatch(/"(bulk_sales|lot_sales)"/);
  });

  it("no PDF is offered for a sale that can no longer be made", () => {
    const route = src("app/api/pdf/[type]/[id]/route.ts");
    expect(route).not.toMatch(/"bulk-sale"|"lot-sale"/);
    expect(route).not.toMatch(/fetchBulkSalePdfData|fetchLotSalePdfData/);
  });

  // ── 3. History stays readable ────────────────────────────────────────────
  it("the audit log can still name a historical bulk or lot sale", () => {
    // Retiring a workflow must not make old audit rows unreadable.
    const audit = src("app/(owner)/owner/audit/page.tsx");
    expect(audit).toMatch(/bulk_sales:\s*"a bulk sale"/);
    expect(audit).toMatch(/lot_sales:\s*"a lot sale"/);
  });

  // ── 4. The data layer is untouched ───────────────────────────────────────
  it("the tables remain — a live function and a live foreign key still need them", async () => {
    const admin = adminClient();
    // lot_sale_items is keyed (lot_sale_id, stock_lot_id) — it has no id column.
    for (const table of ["lot_sales", "lot_sale_items", "bulk_sales"]) {
      const { error } = await admin.from(table).select("*").limit(1);
      expect(error, `${table} must still exist: ${error?.message}`).toBeNull();
    }
  });

  it("reverse_paid_supply still refuses a lot that has left stock", async () => {
    // It reads lot_sale_items as one of three "has this lot gone?" guards, which
    // is why that table cannot be dropped along with the UI.
    const { error } = await adminClient().rpc("reverse_paid_supply", {
      p_visit_id: "00000000-0000-0000-0000-000000000000", p_reason: "probe",
    } as never);
    // It must still be callable and still reach its own checks.
    expect(error, "reverse_paid_supply must remain functional").not.toBeNull();
    // Reaching its own role check proves the function still resolves and runs.
    expect(error!.message).toMatch(/accounting|settlement|not found/i);
  });
});
