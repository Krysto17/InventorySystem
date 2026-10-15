import { describe, it, expect } from "vitest";
import { anonClient } from "../setup/supabase-test-clients";

/**
 * What an unauthenticated caller with the public anon key can reach.
 *
 * This exists to stop a future policy written without a TO clause — which
 * defaults to the Postgres `public` role, and therefore includes anon — from
 * silently opening a table. Every business table must return nothing.
 */
const MUST_BE_EMPTY = [
  // people
  "profiles", "setup_codes",
  // money
  "batch_settlements", "settlement_payments", "settlement_payout_splits",
  "advances", "advance_deductions", "advance_shares", "consumables",
  "payments", "pricing", "price_corrections", "utility_charges", "cost_price_runs",
  // stock
  "stock_lots", "stock_movements", "stock_confirmations", "bulk_sales", "lot_sales",
  // the workflow and its records
  "visits", "visit_materials", "xrf_records", "analysis_records",
  "processing_records", "batch_comments", "gate_passes",
  // trade partners and the trail
  "suppliers", "bank_accounts", "transaction_events",
];

describe("anonymous access", () => {
  for (const table of MUST_BE_EMPTY) {
    it(`anon reads nothing from ${table}`, async () => {
      const { data, error } = await anonClient().from(table).select("*").limit(1);
      // Either refused outright or filtered to nothing — both are acceptable;
      // returning a row is not.
      expect(error ? [] : data ?? [], `anon must not read ${table}`).toHaveLength(0);
    });
  }

  it("anon cannot write anywhere it can see nothing", async () => {
    const anon = anonClient();
    const attempts = [
      anon.from("suppliers").insert({ name: `anon-${Date.now()}` }),
      anon.from("consumables").insert({ site_id: crypto.randomUUID(), name: "x", category: "others" }),
      anon.from("transaction_events").insert({ event_type: "owner_override", payload: {} }),
    ];
    for (const a of attempts) {
      const { error } = await (a as unknown as Promise<{ error: unknown }>);
      expect(error).not.toBeNull();
    }
  });

  it("anon cannot call the privileged RPCs", async () => {
    const anon = anonClient();
    // prune_transaction_events is owner-only; my_pending_counts is per-caller.
    expect((await anon.rpc("prune_transaction_events", { p_older_than: "1 day" } as never)).error).not.toBeNull();
    const counts = await anon.rpc("my_pending_counts");
    // It may answer, but every count must be zero — anon actions nothing.
    if (!counts.error && counts.data) {
      const values = Object.values(counts.data as Record<string, number>);
      expect(values.every((v) => Number(v) === 0)).toBe(true);
    }
  });
});
