# Phase 3 Financial Model — Design Spec

**Date:** 2026-06-02  
**Phase:** 3 of 8  
**Status:** Implementation complete

---

## Purpose

Make the `in_accounting` state actionable. Accountant logs payments against a visit's two
independent money figures, tracks running balances, and marks the visit settled when both
sides are cleared. Once settled, the visit transitions to `awaiting_stock_intake`.

---

## Two money figures per visit (from system-wide spec §5)

| Direction | Label | Who owes | When it exists |
|---|---|---|---|
| `processing_fee_in` | Processing fee | Client → Company | Only on `unprocessed` visits |
| `purchase_amount_out` | Purchase amount | Company → Client | Only when `agreement_status = agreed` |

Both figures are independent. `processing_fee_in` is owed even if no sale happened
(`not_agreed`). `purchase_amount_out` only exists on agreed visits.

---

## Schema additions

### `payments` table

```sql
payments
  id uuid PK
  visit_id FK -> visits (NOT NULL)
  direction text CHECK (direction IN ('processing_fee_in', 'purchase_amount_out'))
  amount numeric(14,2) NOT NULL CHECK (amount > 0)
  paid_at timestamptz NOT NULL DEFAULT now()
  method text CHECK (method IN ('cash', 'transfer', 'deduction', 'other'))
  notes text
  recorded_by uuid REFERENCES profiles(id)
  created_at timestamptz NOT NULL DEFAULT now()
```

### `visits` column addition

```sql
visits ADD COLUMN processing_deducted boolean NOT NULL DEFAULT false
```

When `processing_deducted = true` and the visit is agreed, the net company→client payout is
`purchase_amount − processing_fee`. The Accountant flips this flag; it affects how balances
are displayed, not how payment rows are stored.

---

## Balance computation

Balances are computed on read (not stored):

- **Processing fee owed:** `SUM(usage.line_cost)` from `processing_machine_usage` via `processing_records`. Present only on unprocessed visits.
- **Processing fee paid:** `SUM(amount)` WHERE `direction = 'processing_fee_in'` for the visit.
- **Purchase amount owed:** `pricing.purchase_amount` (set by pricing trigger). Present only on agreed visits.
- **Purchase amount paid:** `SUM(amount)` WHERE `direction = 'purchase_amount_out'` for the visit.

When `processing_deducted = true` the UI shows:
- Net payout = purchase_amount − processing_fee
- Effectively the two streams are settled against each other

---

## Settlement and state transition

The Accountant explicitly clicks "Mark settled". A server action validates:
- For agreed visits: the outstanding balance in both directions is zero (or
  `processing_deducted` is true and the net figure is zero).
- For exited/not-agreed visits: only `processing_fee_in` matters; no purchase settlement.

On settlement, the visit transitions `in_accounting` → `awaiting_stock_intake`.

**Design decision (from BUILD_PHASES.md):** Settlement is explicit (Accountant button), not
automatic. Zero balance doesn't always mean "we're done" with the relationship — installments
may span multiple visits.

---

## Edit on exited visits

Exited visits (no-agreement path) still accumulate `processing_fee_in` payments. The
Accountant can add incoming payments on exited visits but cannot add outgoing payments (no
purchase happened). Enforced in the server action.

---

## RLS

- Accountant at site X: read+write payments for visits at site X.
- Other non-owner roles: read-only on payments at own site.
- Owner: full access.
- No one can write directly to payments from client code — all writes go through server actions.

---

## Accounting screen `/accounting`

Queue: visits in `in_accounting` (and optionally exited visits with unpaid processing fees).

Visit detail Payments card (extends `/visits/[id]`):
- Displays both balances.
- Accountant can log new payment (direction, amount, method, notes).
- Accountant can toggle `processing_deducted` flag.
- "Mark settled" button → calls `settleVisit` server action.

---

## Out of scope

- Bulk-sale revenue tracking (Phase 4).
- General cash flow / P&L.
- Payment schedules or future-dated commitments.
- Reversal rows (use a new payment row with notes instead).
