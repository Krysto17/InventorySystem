# Mining Material Tracking & Inventory System — Design Spec

**Date:** 2026-05-27
**Company:** MAGNETIC JOEZION NIG. LTD
**Status:** Approved design, pending implementation plan

> This spec supersedes the legacy `project.md`. `project.md` is a stale, over-scoped
> document; only the physical-flow, roles, financial model, and inventory concepts
> described here are authoritative. The XRF analysis field list in `project.md` is
> reused only as a starting template for the analysis report.

---

## 1. Purpose

A role-based data monitoring system for a family-run tin / raw-metals processing and
purchasing business operating **three sites**. It tracks the full lifecycle of each
supplier visit — gate intake, processing, analysis, pricing, payment, stock intake —
plus outbound bulk sales of stored stock. The **owner** needs full cross-site oversight
through a dashboard, and every subprocess must be exportable as a branded PDF.

**Out of scope:** All human communication happens over WhatsApp, completely outside this
application. There is no messaging, notification, or chat feature in the system.

---

## 2. Stack & Architecture

- **Next.js (App Router) + TypeScript**, deployed on **Vercel**. TypeScript/JavaScript
  only — no Python, no separate hand-rolled backend.
- **Supabase** provides Postgres + Auth + Storage. There is no separate backend service;
  Supabase is the backend.
- **Row-Level Security (RLS) is the real security boundary.** Every table's access is
  enforced in the database by `role` + `site_id`. A tampered or malicious client still
  cannot read or write outside its lane. UI-level hiding is secondary.
- **Privileged operations** (owner provisioning employees, issuing one-time setup codes,
  server-side PDF generation) run in **Next.js server actions / route handlers** holding
  the Supabase **service-role key**. This key is never shipped to the browser.
- **Route groups by role**: `/gate`, `/processing`, `/receiving`, `/manager`,
  `/accounting`, `/inventory`, `/owner`. Middleware reads the session's role and redirects
  to the correct home; no role can load another role's screens.

---

## 3. Roles (7)

Each user has exactly one role and is bound to one `site_id` (except the owner, who is
cross-site). Each role logs in to its own dedicated screen.

| Role | Can do | Scope of visibility |
|---|---|---|
| **Gate / Security** | Open a visit (intake) + record security check; release a returning package as `exited` **only** after an owner authorization exists | Own site, gate/exit stages |
| **Processing** | Record machines used + quantities (→ processing fee) on `in_processing` visits | Own site, processing queue |
| **Receiving** | Record the analysis (grade / XRF / QC) on `in_receiving` visits | Own site, receiving queue |
| **Manager** | Set / agree the material unit price on `pricing` visits; mark `agreed` / `not_agreed` | Own site, full visit detail |
| **Accounting** | Set payment terms, log payments, track balances on `in_accounting` visits | Own site, financial records |
| **Inventory Manager** | Take completed purchases into stock (`stocked`); record outbound bulk sales (pending owner approval) | Own site, stock + sales |
| **Owner** | Override unit prices; authorize gate exits; approve bulk sales; provision employees; **read everything across all three sites** | All sites, all stages, dashboards, inventory |

**Authority notes:**
- The **Manager** is the top *operational* authority for pricing, but the **Owner** can
  override any unit price the manager set.
- The **Owner** is the only cross-site, full-read role.
- Bulk (outbound) sales require **Owner approval** before stock decrements.

---

## 4. Central Object: the Visit

A **Visit** = one supplier bringing material on one occasion. It is the spine of the
inbound workflow and moves through a status pipeline.

- `entry_path`: `unprocessed` (material must go through the plant) or `pre_processed`
  (already processed elsewhere; skips the plant, goes straight to receiving).
- Each transition appends a row to `transaction_events` (append-only audit log).

### 4.1 State Machine

```
                          ┌─ entry_path = unprocessed ─┐
at_gate_in (Gate) ───────▶ in_processing (Processing) ─┐
   │                                                    ▼
   └─ entry_path = pre_processed ─────────────▶ in_receiving (Receiving: records analysis)
                                                         │
                                                         ▼
                                                 pricing (Manager sets unit price from grade;
                                                          Owner may override)
                                                         │
                              ┌──────────────────────────┴───────────────────────────┐
                       agreement reached                                       no agreement
                              ▼                                                        ▼
                     in_accounting (Accountant:                          awaiting_gate_exit
                     terms, payment ledger)                              (needs Owner sign-off)
                              ▼                                                        ▼
                     awaiting_stock_intake                                owner authorizes ▶ exited
                              ▼                                          (Gate opens; client leaves
                     stocked (Inventory Mgr records                       with package)
                     material into stock)                    • unprocessed path → client still owes processing fee
                              ▼                              • pre_processed path → nothing owed
                        Owner oversight
```

### 4.2 Invariants (enforced in DB / server logic)

- **Pricing is blocked until an `analysis_record` exists** for the visit — grade/purity
  drives the agreed price.
- **A processing fee only exists on the `unprocessed` path** (the company only charges for
  processing it actually performed).
- **`awaiting_gate_exit` → `exited` requires a `gate_exit_authorizations` row** signed by
  the owner.
- **`awaiting_stock_intake` → `stocked` is performed only by the Inventory Manager** and
  writes an inbound `stock_movements` row.
- Every status transition writes a `transaction_events` row.

---

## 5. Financial Model

Per visit there are **two independent money figures**, each settled separately:

1. **Processing fee** — owed *by client to company*. Exists only on the `unprocessed`
   path. Computed from machines used (see §6). **Owed even when no sale happens** (the
   unhappy path where the client takes material back).
2. **Purchase amount** — owed *by company to client*. `agreed_unit_price × weight`. Exists
   only when `agreement_status = agreed`.

Controls:
- **`processing_deducted` flag** — when true and a sale happens, net company→client
  payout = purchase amount − processing fee; when false, the two amounts are settled
  separately.
- **Payment terms** per visit: `immediate` / `deferred` / `installment`.
- **`payments` ledger** logs each settlement (direction, amount, date, method, recorder);
  the **running balance per direction** is derived. This handles partial and installment
  payments without rigid schedules.

---

## 6. Machines & Processing Cost

- A **machine** belongs to a site and has a `charge_basis` of `weight`, `bag`, or `hour`
  plus a `rate` for that basis (e.g., ₦/kg, ₦/bag, ₦/hour).
- A **processing record** captures which machine(s) were used and the measured quantity in
  each machine's basis. Line cost = `rate × quantity`, **snapshotted** at processing time
  (so later rate changes don't rewrite history). The processing fee = sum of line costs.
- A single processing job may use multiple machines, each adding its own line cost.

---

## 7. Inventory & Bulk Sales

Inventory is modeled as a **ledger**, not a counter, for full auditability.

- **`stock_movements`** — every row is an `in` or `out`, tagged by `site_id`,
  `material_type`, `grade`, `weight`, with `recorded_by`, timestamp, `reason`
  (`purchase_intake` / `bulk_sale` / `adjustment`), and a reference (visit for intake, sale
  for outflow). **Current stock = sum of movements** per site × material type × grade.
- **Inbound (purchase intake):** after Accounting `completed`, the visit routes to the
  Inventory Manager (`awaiting_stock_intake`), who records the actual stored weight/grade
  → status `stocked`, writing an inbound movement. Human-confirmed for accuracy.
- **Outbound (bulk sale):** `bulk_sales` entity — buyer, material type, grade, weight,
  unit price, total, date, `recorded_by`, `approval_status`. The Inventory Manager creates
  the sale; it is **pending until the Owner approves it**. On owner approval, an outbound
  `stock_movements` row is written and stock decrements.
- **Consumables:** `consumables` (on-hand) + `consumable_movements` (usage log), per site.

---

## 8. Data Model (tables)

- `sites` — the three sites.
- `profiles` (1:1 with `auth.users`) — `full_name`, `role`, `site_id`, `status`,
  `created_by`.
- `setup_codes` — one-time provisioning codes (hashed, bound to role + site, expiry,
  `used_at`).
- `suppliers` — clients bringing material (name, phone, ID doc, notes).
- `material_types` — lookup (tin, etc.) + grade scale.
- `visits` — central object (§4).
- `machines` — per-site machine registry (§6).
- `processing_records` + `processing_machine_usage` — §6.
- `analysis_records` — `sample_id`, `xrf_result`, `purity`, `grade`, `qc_observations`,
  `weight`, `analyzed_at`.
- `pricing` — `agreed_unit_price`, `purchase_amount`, `priced_by`, `overridden_by`,
  `agreement_status` (`pending` / `agreed` / `not_agreed`).
- `payments` — settlement ledger (§5); visit holds `terms` + `processing_deducted`.
- `gate_exit_authorizations` — owner sign-off to release a returning package.
- `stock_movements` — inventory ledger (§7).
- `bulk_sales` — outbound sales, owner-approved (§7).
- `consumables` + `consumable_movements` — §7.
- `transaction_events` — append-only audit log driving history + PDFs.

---

## 9. Authentication & Provisioning

- **No public signup.** The Owner provisions every account from his dashboard: enters
  name + role + site; the system generates a **one-time setup code / temporary password**.
- The Owner hands the code to the employee over **WhatsApp** (their existing channel — no
  email dependency).
- The employee logs in with the code and sets their own password. Role and site are fixed
  by the owner and cannot be self-assigned.
- Provisioning runs in a server action using the Supabase service-role key.

---

## 10. Owner Dashboard

- **Cross-site oversight:** visit volume and status funnel per site, money in/out,
  outstanding balances, rejection rate, processing throughput — filterable by site / date /
  material type.
- **Inventory view:** live stock by site × material type × grade → total weight; machine
  registry + utilization; consumables on-hand + movements.
- **Drill-down:** any tile → underlying visit list → single visit timeline (from
  `transaction_events`).

---

## 11. PDF Export (per subprocess)

Each subprocess record exports its own **branded** PDF (header: MAGNETIC JOEZION NIG. LTD):
- Gate intake slip
- Processing report (machines + fee)
- Analysis report (XRF / grade — fields seeded from `project.md`)
- Pricing / agreement sheet
- Payment statement
- Bulk sale receipt
- Full visit dossier (all stages + audit trail)

Generated server-side (route handler). Downloadable by any role with read access to the
record; the owner can export anything.

---

## 12. Testing Strategy

- **RLS policy tests (most critical):** each role can perform exactly its allowed
  transitions and nothing else; cross-site isolation holds; owner sees all.
- **State-machine tests:** illegal transitions are rejected (pricing before analysis;
  `exited` without owner authorization; `stocked` by non-inventory roles; bulk sale stock
  decrement without owner approval).
- **Financial calculation tests:** processing-fee math across all three machine bases;
  deduction vs. separate settlement; running balance after partial/installment payments.
- **Inventory ledger tests:** stock = sum of movements; bulk sale decrements only after
  owner approval.
- **Component tests** for each role screen.
- **End-to-end flows:** happy path (agreement → accounting → stocked) and both unhappy
  paths (no agreement → owner signs out → exited, for unprocessed and pre_processed).

---

## 13. Explicitly Out of Scope

- Any in-app communication / messaging / notifications (WhatsApp handles all of this).
- The legacy `project.md` roles that don't match this flow (Chief Auditor, Stock Auditor,
  Data Entry Personnel as separate role), Node/Express backend, MongoDB/Firebase,
  barcode/QR, mobile app, AI anomaly detection, offline sync, supplier portal.