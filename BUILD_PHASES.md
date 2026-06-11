# MAGNETIC JOEZION NIG. LTD — Inventory System Build Phases

> **Handoff document.** This file is the index for whoever is taking over the build. Start here, then drill into the linked spec/plan files. The owner who briefed me is on WhatsApp for clarifications; the manager taking over this document is expected to know the business better than the original briefing and should feel free to amend decisions captured in the phase docs.

> **For the manager:** You don't need to be a developer to drive this. Almost every step here is run by a Claude Code agent — you read each phase, copy the relevant section into Claude, and Claude does the work. You stay in the driver's seat for **business decisions** (what materials, what grades, when to override pricing, etc.). Git, Supabase, and Next.js are the agent's job, not yours. When this document gives you a shell command, copy it exactly as written. When it uses a term you don't know, search this file for "Glossary" — it's at the very end.

**System purpose:** Role-based data-monitoring web app for a family-run tin / raw-metals processing and purchasing business with **three sites**. Tracks the full lifecycle of every supplier visit (gate → processing → analysis → pricing → payment → stock) plus outbound bulk sales of stored stock. Owner needs full cross-site oversight; every subprocess exports a branded PDF.

**Stack (hard constraints):**
- **Next.js 16 (App Router) + TypeScript + Tailwind v4**, deployed on **Vercel**. TypeScript/JavaScript only.
- **Supabase** (Postgres + Auth + Storage) is the only backend.
- **RLS is the security boundary** — every table enforces access in the database by `profiles.role` + `profiles.site_id`.
- **No public signup.** Owner provisions every account; email-free username login.
- **No in-app communication.** WhatsApp handles all human comms outside the app.

**Authoritative design spec:** `docs/superpowers/specs/2026-05-27-mining-inventory-system-design.md` (system-wide) + `docs/superpowers/specs/2026-05-29-phase-2-visit-workflow-design.md` (Phase 2).

**Business rules already captured** are inlined in the "Critical business rules" section near the end of this file. (They were originally saved as Claude project memories on the original author's laptop; that storage is local-only and doesn't transfer with the repo, so the same content is duplicated here for handoff.)

---

## How to use this document

Each phase below has the same shape:

1. **Goal** — one sentence
2. **Status** — `DONE` / `PLAN COMPLETE` / `NOT STARTED` / `BLOCKED`
3. **Artifacts** — spec file, plan file, branch, commits/tag
4. **Planning step** — what to brainstorm with the owner before building
5. **Implementation summary** — what gets built; high-level
6. **Testing strategy** — Vitest suites required to pass
7. **Playwright walkthrough** — manual or scripted browser scenarios to confirm the phase works end-to-end
8. **Manager checkpoints** — places to revisit captured decisions

**Phase-by-phase workflow each Claude agent should follow** (the `superpowers` skill plugin makes this nearly automatic):

```
brainstorming  →  spec doc  →  writing-plans  →  plan doc  →
   subagent-driven-development  →  per-task TDD  →
   acceptance gate (Vitest + Playwright + npm run build)  →
   finishing-a-development-branch  →  merge or hold for batch merge
```

If you skip brainstorming for a phase, you'll skip the moments where the owner corrects assumptions.

---

# Phase 1 — Foundation ✅ DONE

**Goal:** Scaffold the Next.js + Supabase project; ship `sites`, `profiles`, `setup_codes`, auth, role routing, owner provisioning.

**Status:** `DONE`. Tagged `phase-1-foundation`. 13 tests passing. Owner manually provisions employees via `/owner/employees`; employees set their own password on first login.

**Artifacts:**
- Spec: `docs/superpowers/specs/2026-05-27-mining-inventory-system-design.md` (§§ 1–13, system-wide)
- Plan: `docs/superpowers/plans/2026-05-27-phase-1-foundation.md`
- Branch: `phase-1-foundation`
- Migrations: `0001_sites.sql`, `0002_roles_enum_and_profiles.sql`, `0003_profiles_rls.sql`, `0004_setup_codes.sql`, `0005_sites_read_policy.sql`
- Key source: `src/middleware.ts`, `src/lib/auth/roles.ts`, `src/lib/auth/get-profile.ts`, `src/lib/supabase/{server,client,admin}.ts`, `src/lib/provisioning/`, `src/app/(owner)/owner/employees/`, `src/app/login/`, `src/app/set-password/`

**What's been verified (don't re-do):**
- 7 roles: `gate`, `processing`, `receiving`, `manager`, `accounting`, `inventory`, `owner`
- Email-free username login → synthetic `<username>@magneticjoezion.local`
- `must_change_password` flag enforces first-login password reset
- RLS column-level grant on `profiles.must_change_password` (privilege-escalation fix)
- Cookie-bound auth via `@supabase/ssr` with `redirectWithSession` middleware helper
- Middleware lives at `src/middleware.ts` (Next.js 16 with `--src-dir` only loads middleware from that path)
- Cloud Supabase project ref: `wevkljmhucuhfqjgeqcb` (keys in `.env.cloud.local`, NOT committed)
- Local Supabase via `npx supabase start` on `127.0.0.1:54321`
- Test safety guard in `tests/setup/supabase-test-clients.ts` aborts if test URL isn't localhost (prevents wiping cloud auth users)

**Phase 1 backlog carried into future phases:**
- Rename `src/middleware.ts` → `src/proxy.ts` (Next.js 16 deprecation; works fine for now)
- Add logout server action + UI
- Update `layout.tsx` metadata + replace stock README
- Form-level require `siteId` for non-owner roles
- Restrict `/set-password` to users with `must_change_password=true`
- Rename `public.current_role()` → `public.get_app_role()` to avoid shadowing
- Scoped (prefix-based) test cleanup instead of wipe-all
- Push migrations to cloud project `wevkljmhucuhfqjgeqcb` (deferred to Phase 8 deploy)

**Manager checkpoint:** Re-run Phase 1 Playwright walkthrough (below) before starting any new phase to confirm the foundation still works after dependency upgrades or environment changes.

**Phase 1 Playwright walkthrough:**

```
PRE: npx supabase start; npm run dev

1. Visit http://localhost:3000 → redirects to /login.
2. Provision the first owner via the bootstrap node script:
   node scripts/bootstrap-owner.js "Owner Name" owner1 "tempPass!23"
   (Or use the documented one-liner with service-role key.)
3. Log in at /login with username "owner1", password "tempPass!23".
4. Redirected to /set-password (must_change_password is true).
5. Set a new password. Redirected to /owner.
6. Click "Employees" → create employees for each role:
   • gate1 → role: gate, site: Osun
   • proc1 → role: processing, site: Osun
   • recv1 → role: receiving, site: Osun
   • mgr1  → role: manager, site: Osun
   • acct1 → role: accounting, site: Osun
   • inv1  → role: inventory, site: Osun
   For each, note the generated temp password.
7. Log out (no logout button yet; clear cookies or use a different browser).
8. Log in as gate1 → redirected to /set-password → new password → /gate.
9. Try to visit /processing → redirected back to /gate (role isolation works).
10. Log in as owner1 → can visit any /role/* URL.

PASS criteria: all redirects work; no role can reach another role's home; owner can reach everything.
```

---

# Phase 2 — Inbound Visit Workflow ✅ DONE

**Goal:** Build the visit pipeline from gate intake through Manager pricing, plus the no-agreement Owner-authorized gate exit. Visits can reach `in_accounting` (Phase 3 waits there) or `exited` (terminal).

**Status:** `DONE`. All 26 tasks implemented. Migrations 0007-0014, all role screens, shared visit detail page, and full test suite committed on `phase-2-visit-workflow`.

**Artifacts:**
- Spec: `docs/superpowers/specs/2026-05-29-phase-2-visit-workflow-design.md`
- Plan: `docs/superpowers/plans/2026-05-29-phase-2-visit-workflow.md` (5,240 lines, 26 tasks with TDD steps + complete code)
- Branch: `phase-2-visit-workflow`
- Last commit before pause: `e8bfc11 fix(plan): use adminClient() factory call throughout Phase 2 plan`

**What Phase 2 builds (summary):**

New tables: `suppliers`, `material_types`, `machines`, `visits`, `processing_records`, `processing_machine_usage`, `analysis_records`, `pricing`, `gate_exit_authorizations`, `transaction_events`.

New screens: `/gate` + `/gate/intake`, `/processing`, `/receiving`, `/manager`, owner extensions at `/owner/material-types` + `/owner/machines` + `/owner/visits`, plus the shared `/visits/[id]` detail page reused by every role.

New triggers: state-machine validator on `visits`, audit-log writers on every stage table, state-transition triggers (processing INSERT → in_receiving; analysis INSERT → pricing; pricing UPDATE agreement_status → in_accounting/awaiting_gate_exit), `purchase_amount` maintenance on `pricing`.

**Planning step (re-brainstorm with owner before building):**

The owner gave answers during the Phase 2 design conversation but the **manager taking over should verify these are still right** because the owner is not technical and may have agreed to plausible-sounding defaults. Re-confirm:

| Decision | Captured answer | Likely manager review needed? |
|---|---|---|
| Gate intake fields | Name, phone, vehicle plate, declared material type (enum), entry path | Low risk — minimum viable |
| Material types | Owner-managed enum table; default seed: Tin Ore, Columbite, Tantalite, Lead Concentrate, Zinc Concentrate | **MEDIUM — manager should confirm the actual material list and the company's grade scale** |
| Suppliers | Global master list; gate searches first, adds new on the fly; no site partitioning of the list | Low risk |
| Processing fee | Charged on INPUT (kg/bag/hour per machine basis); **no output_weight on processing_records** — receiving weighs the output | **HIGH — this is a financial rule; manager must confirm and document any plant-specific exceptions** |
| Pricing record | Manager sets unit_price + agreement decision + payment_terms; **payment_terms is the Owner's call, transcribed by Manager** via WhatsApp | **HIGH — this trusts a verbal handshake. Manager may want a formal "Owner confirms" step. Currently the system just trusts Manager.** |
| No-agreement exit | Owner clicks "Authorize exit" in the app → Gate sees "Ready to release" → clicks "Release" → state=exited | Low risk — simple, secure |
| Edit policy | Each role edits its own record freely until the visit reaches `exited` or `stocked`; Owner can edit anything anytime; all edits audited in `transaction_events` | **MEDIUM — manager should consider whether some records should lock earlier (e.g., once pricing is agreed, can analysis weight still change? If yes, purchase_amount auto-recomputes — but that may surprise an Accountant in Phase 3)** |
| Machines | Owner-managed; per site; `charge_basis` of weight/bag/hour with a `rate` | Low risk |
| transaction_events | Append-only audit log written exclusively by `SECURITY DEFINER` triggers (clients can't insert directly) | Low risk |

The owner explicitly said:
- *"Some machines are processed by unit weights, some by number of bags processed, some by number of hours used."* → the 3-way `charge_basis` matches this.
- *"Depends on the deal — sometimes the owner agrees to receive payments at a later date, installmentally, or deducted."* → the 4 `payment_terms` values (immediate / deferred / installment / deducted) reflect this.
- *"Right after analysis, the quality of the material determines what price negotiations would happen."* → `pricing` is blocked until `analysis_records` exists.
- *"For bulk sale, let only the owner be able to approve it."* → Phase 4 feature; not in Phase 2.
- *"It isn't a full financial system because business funds don't all remain in the business."* → app tracks per-visit money only; bulk-sale revenue stays with the Owner outside the app.

**Implementation:** Follow `docs/superpowers/plans/2026-05-29-phase-2-visit-workflow.md` task by task using the `superpowers:subagent-driven-development` skill. Each task is TDD: failing test → minimal impl → green test → commit. The plan provides verbatim SQL and TypeScript code for every step. Approximate work: 26 tasks; each migration task is ~5-10 minutes of implementer time, each UI task is 10-20.

**Testing strategy (must pass before declaring Phase 2 done):**

| Suite | Files | What it proves |
|---|---|---|
| RLS | `tests/rls/{suppliers,material-types,machines,visits,processing-records,analysis-records,pricing,gate-exit-authorizations,transaction-events}.rls.test.ts` | Own-lane permitted, cross-lane denied, cross-site denied for non-owner, owner permitted everywhere, edit-after-close denied for non-owner |
| State machine | `tests/state-machine/{transitions,invariants,owner-override}.test.ts` | Legal transitions succeed, illegal rejected with clear error; pricing → in_accounting blocked without analysis; awaiting_gate_exit → exited blocked without authorization; closed_at set on terminal entry; owner backward jump logs `owner_override` event |
| Integration | `tests/integration/{happy-path-unprocessed,happy-path-preprocessed,no-agreement-exit,edit-while-open,edit-after-close}.test.ts` | End-to-end flows produce the right states, records, and events |
| Audit | `tests/audit/{events-written,diff-helper}.test.ts` | Every action appends exactly one event; `jsonb_diff_changed()` returns only changed keys |
| Lib | `tests/lib/state-machine.test.ts` | TS state-machine mirror matches DB allowed set |

Expected count: ~79 tests (Phase 1's 13 + ~66 new in Phase 2).

**Phase 2 Playwright walkthrough (manual, after acceptance gate):**

```
PRE: npx supabase db reset; npm run dev. Owner has already provisioned gate1/proc1/recv1/mgr1 at the same site.

HAPPY PATH (unprocessed → agreed):
1. Log in as gate1 → /gate.
2. Click "+ New visit intake" → /gate/intake.
3. In supplier search, type a phone number (no match expected) → click "Add new supplier" → fill name + phone.
4. Fill vehicle plate, pick material from dropdown, select "Unprocessed".
5. Click "Save intake" → redirected to /visits/[id]. State shows "in_processing".
6. Log out, log in as proc1 → /processing.
7. Click the new visit → /visits/[id]. Processing card shows form.
8. Pick a machine, enter a measurement, see auto-computed fee. Submit.
9. Page refreshes; state shows "in_receiving"; processing details now read-only with edit button.
10. Log out, log in as recv1 → /receiving.
11. Click visit → Analysis form. Enter weight, grade, optional XRF JSON. Submit.
12. Page refreshes; state shows "pricing".
13. Log out, log in as mgr1 → /manager.
14. Click visit → Pricing form shows analysis weight. Enter unit price, mark "Agreed", pick payment terms. Submit.
15. State shows "in_accounting". Audit trail shows full timeline.

PASS criteria: state transitions correctly; audit trail records each action; purchase_amount = unit_price × analysis_weight.

NO-AGREEMENT PATH:
Repeat steps 1-12 as above, then:
13. Manager marks "No agreement" → submit.
14. State shows "awaiting_gate_exit".
15. Log out, log in as owner1 → /owner.
16. Cross-site awaiting-exit board shows the visit. Click it.
17. On visit detail, "Authorize exit" form is visible. Add optional note, submit.
18. Page refreshes; authorization shown with timestamp.
19. Log out, log in as gate1 → /gate.
20. "Awaiting release" section shows the visit. Click it.
21. "Release supplier" button is now enabled. Click it.
22. State shows "exited"; closed_at is set; audit trail shows the full no-agreement journey.

PASS criteria: gate can't release without owner authorization; closed visit's records are read-only for non-owner; processing fee is still owed (visible on processing card) even though no purchase happened.

EDIT POLICY:
1. Log in as recv1 → open a visit currently in "pricing" state.
2. Click "Edit" on the analysis card. Change weight from 100 to 110. Save.
3. Verify audit trail has "Record edited" event with diff {weight: {old: 100, new: 110}}.
4. Log in as mgr1, open the same visit. If pricing already exists with unit_price set, the purchase_amount should have auto-recomputed.
5. Walk the visit to "exited". Log in as recv1 again, try to edit the analysis card. Edit silently fails (no error, no change visible after refresh).
6. Log in as owner1, edit the same closed visit's analysis. Succeeds; audit log shows owner_override.

PASS criteria: open visits are editable by the recording role; closed visits are owner-only; all edits audited.
```

**Manager checkpoints in Phase 2:**

1. **Material type list:** before running migration `0006_material_types.sql`, confirm the actual material types the company processes. Edit the migration's seed `INSERT` statement; don't fix it later via the UI (any visits referencing a renamed type would point at the wrong record).
2. **Machine list and rates:** the Owner inputs these via `/owner/machines` after Phase 2 deploys; gather the real rates ahead of time so production goes live with realistic data.
3. **Grade scale convention:** `analysis_records.grade` is `text` (free-form like "A", "B+", "65% pure"). If the company uses a fixed scale, lock it down with a CHECK constraint or convert to an enum table before going live.
4. **purchase_amount auto-recompute:** review the trigger `t_pricing_purchase_amount`. If receiving edits the weight after pricing was agreed, the purchase amount silently changes. Manager may want to BLOCK weight edits once pricing is agreed, or surface a warning.

---

# Phase 3 — Financial Model ✅ DONE

**Goal:** Make the `in_accounting` state actually do something — Accountant manages payments, records partial settlements, tracks running balances per visit.

**Status:** `DONE`. Migration 0015 (payments + processing_deducted), /accounting screen, PaymentsCard, server actions, RLS tests, and integration tests committed on `phase-3-financial-model`.

**Spec:** `docs/superpowers/specs/2026-06-02-phase-3-financial-model-design.md`

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-3-financial-model-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-3-financial-model.md`
- Suggested branch: `phase-3-financial-model` — **branch from `phase-2-visit-workflow`**, not from main (see "Branching strategy" in Quick Reference). Phase 3 needs Phase 2's schema to run any integration test.

**What Phase 3 builds (per existing spec §5):**

```
payments
  id uuid PK
  visit_id FK -> visits
  direction text CHECK (direction IN ('processing_fee_in', 'purchase_amount_out'))
  amount numeric(14,2) NOT NULL CHECK (amount > 0)
  paid_at timestamptz NOT NULL DEFAULT now()
  method text CHECK (method IN ('cash', 'transfer', 'deduction', 'other'))
  notes text
  recorded_by uuid REFERENCES profiles(id)
  created_at timestamptz NOT NULL DEFAULT now()

visits ADD COLUMN processing_deducted boolean NOT NULL DEFAULT false
```

Plus:
- `/accounting` route group with a queue of visits in `in_accounting`
- Visit detail page extended with a Payments card (read by all, write by Accountant + Owner)
- Server actions: `recordPayment`, `editPayment`, `toggleProcessingDeducted`
- Balance computation: per-visit running total of expected vs paid in each direction
- Transition trigger: `visits.state` → `awaiting_stock_intake` when the Accountant marks the visit "settled" (criteria TBD with owner; likely: all `processing_fee_in` paid AND either purchase_amount_out is fully paid OR explicit defer flag)

**Planning step (brainstorm with owner before building):**

1. **What counts as "settled"?** Does the Accountant decide manually, or does the system auto-transition when balances hit zero (or when defer flag set)?
2. **Processing-deducted handling.** Owner said sometimes the processing fee is deducted from the purchase amount. Confirm: does the Accountant flip a flag and the system net-settles automatically? Or does the Accountant record two offsetting payments (one in, one out) explicitly?
3. **Installment recording.** Does each installment get its own row? Are installment schedules ever planned in advance (i.e. a separate `payment_schedule` table) or just recorded as they happen?
4. **Bulk-sale revenue.** Per memory `not-a-full-financial-system`, bulk sale revenue is Owner's domain — NOT tracked in `payments`. Confirm this stays true in Phase 3. If owner wants any tracking, add a `received_amount` field on `bulk_sales` in Phase 4 instead.
5. **Currency.** Should `amount` ever be anything other than NGN? Phase 2 hardcodes NGN formatting; if not, leave it.

Save any non-obvious answers as new project memories.

**Testing strategy:**

- `tests/rls/payments.rls.test.ts` — accountant at site A can read/write payments on site A visits only; non-accounting non-owner blocked from writing; owner full access.
- `tests/integration/installment-payments.test.ts` — record multiple partial payments; verify running balance is correct after each.
- `tests/integration/processing-deducted.test.ts` — toggle the flag; verify net payout calculation matches spec.
- `tests/integration/settled-transition.test.ts` — when settled (criteria from planning step), visit transitions to `awaiting_stock_intake`.
- `tests/audit/payments-audit.test.ts` — every payment insert/edit writes a `transaction_events` row.

**Phase 3 Playwright walkthrough:**

```
PRE: walk a visit through Phase 2 to in_accounting (unprocessed + agreed). Note the processing_fee (₦X) and purchase_amount (₦Y).

1. Log in as acct1 → /accounting. Queue shows the visit.
2. Open visit → Payments card visible.
3. Record an "Incoming" payment for ₦X (the full processing fee). State of the in-direction = paid.
4. Record an "Outgoing" payment for ₦Y/3 (first installment). State of the out-direction = partial, balance = 2Y/3.
5. Record another outgoing payment for ₦Y/3. Balance = Y/3.
6. Record the final outgoing payment. Balance = 0.
7. Click "Mark settled" (or auto-transition if zero balance triggers it).
8. State transitions to awaiting_stock_intake. Audit trail shows all 4 payment records + state change.

DEDUCTED variant:
9. Walk a fresh visit to in_accounting (different supplier).
10. Open it as acct1. Toggle "processing_deducted" = true.
11. Net payout = purchase_amount - processing_fee.
12. Record one outgoing payment for the net amount. Verify balance shows zero.

NO-AGREEMENT carry-over (Phase 2 unhappy):
13. The no-agreement-exit Playwright run in Phase 2 leaves an `exited` visit with an unpaid processing fee.
14. Accountant should still be able to record incoming payments against an `exited` visit (the supplier comes back to settle later).
   ↳ Decide during planning: are exited visits payable, or do they become read-only at exit? Recommendation: exited visits stay open for incoming-direction payments, but no outgoing payments are allowed.
```

**Manager checkpoints in Phase 3:**

1. The owner originally said *"Sometimes the client only pays for processing since he couldn't sell to the company due to disagreement."* — Phase 3 needs to allow incoming payments on `exited` visits. Bake this into the spec.
2. Decide whether "Mark settled" is explicit (Accountant button) or automatic (zero balance + flag). Explicit is safer for installments because zero balance doesn't always mean "we're done" with the relationship.
3. Confirm how dispute reversals are recorded. The system has append-only `transaction_events`, but `payments` allows UPDATE; a reversal is recorded as a negative-amount row, not a delete. Verify with owner.

---

# Phase 4 — Inventory Ledger + Bulk Sales ✅ DONE

**Goal:** Inventory Manager takes purchased material into stock; Owner approves outbound bulk sales; consumables tracked separately.

**Status:** `DONE`. Migration 0016, all inventory screens, StockIntakeCard, owner bulk-sale board, RLS tests, and integration tests committed on `phase-4-inventory`.

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-4-inventory-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-4-inventory.md`
- Suggested branch: `phase-4-inventory` — **branch from `phase-3-financial-model`** (or from main if Phase 3 has already been merged); needs Phase 3's `payments` table to test settled → awaiting_stock_intake transition.

**What Phase 4 builds (per spec §7):**

```
stock_movements
  id uuid PK
  site_id FK -> sites
  material_type_id FK -> material_types
  grade text                              -- (or FK to a grade-enum table)
  weight numeric(12,3) NOT NULL           -- positive number; direction column determines sign
  direction text CHECK (direction IN ('in', 'out'))
  recorded_by FK -> profiles
  created_at timestamptz
  reason text CHECK (reason IN ('purchase_intake', 'bulk_sale', 'adjustment'))
  ref_visit_id FK -> visits NULL          -- set for purchase_intake
  ref_bulk_sale_id FK -> bulk_sales NULL  -- set for bulk_sale

bulk_sales
  id uuid PK
  site_id FK -> sites
  buyer_name text NOT NULL
  buyer_phone text
  material_type_id FK -> material_types
  grade text
  weight numeric(12,3) NOT NULL
  unit_price numeric(12,2) NOT NULL
  total numeric(14,2) GENERATED ALWAYS AS (weight * unit_price) STORED
  sold_at timestamptz NOT NULL DEFAULT now()
  recorded_by FK -> profiles
  approval_status text CHECK (approval_status IN ('pending', 'approved', 'rejected'))
  approved_by FK -> profiles NULL
  approved_at timestamptz NULL
  received_amount numeric(14,2)           -- optional; owner-tracked; per memory not-a-full-financial-system

consumables
  id uuid PK
  site_id FK -> sites
  name text NOT NULL
  on_hand numeric(12,3) NOT NULL DEFAULT 0
  unit text                               -- e.g. "kg", "L", "pcs"

consumable_movements
  id uuid PK
  consumable_id FK -> consumables
  delta numeric(12,3) NOT NULL            -- negative = consumed, positive = restocked
  recorded_by FK -> profiles
  reason text
  created_at timestamptz
```

Plus:
- Visit state transition `awaiting_stock_intake` → `stocked` via the Inventory Manager's purchase-intake action (writes a `stock_movements` row of direction `in`, reason `purchase_intake`).
- `/inventory` route group: stock-by-grouping view (site × material × grade → live weight), purchase-intake queue, bulk-sales create form.
- Owner approval flow on `bulk_sales` — Inventory Manager creates pending row; Owner sees in their queue; approving writes the matching `stock_movements` row of direction `out`, reason `bulk_sale`.
- Consumables CRUD (Inventory Manager + Owner).
- Trigger guard: `stock_movements` direction `out` cannot exceed the current sum of `in` − `out` per (site, material_type, grade). This is the stock-balance invariant.

**Planning step (brainstorm with owner before building):**

1. **Grade representation.** Phase 2 stores grade as `text` on `analysis_records`. Stock is bucketed by (site × material × grade). If grade is free-form, the bucketing is fragile ("A" vs "Grade A" vs "A+" become separate buckets). Consider an enum or grade table.
2. **Adjustments.** Owner may need to manually adjust stock (waste, theft write-off). Phase 4 covers `reason='adjustment'`. Confirm who can record adjustments (Inventory Manager? Owner only?).
3. **Bulk-sale rejection.** Owner can reject a pending bulk sale. What happens? Just `approval_status='rejected'` and no stock movement? Or does Inventory Manager get a "fix and re-submit" loop?
4. **Negative stock prevention.** The trigger guard blocks Inventory Manager from creating a bulk sale exceeding current stock. Confirm: should the owner ALSO be blocked, or can owner override (with a warning)?
5. **Consumables.** Out of scope or core? Plant operators use diesel, lubricants, sacks, etc. The Inventory Manager may or may not track these. Confirm scope.

**Testing strategy:**

- `tests/rls/{stock_movements,bulk_sales,consumables,consumable_movements}.rls.test.ts`
- `tests/integration/purchase-intake.test.ts` — visit in `awaiting_stock_intake` → Inventory Manager records intake → visit `stocked` + stock_movements row written.
- `tests/integration/bulk-sale-owner-approval.test.ts` — pending bulk sale doesn't decrement stock; on owner approval, an `out` movement is written and stock decrements; rejection writes no movement.
- `tests/integration/stock-balance-invariant.test.ts` — creating a bulk_sale exceeding current stock is rejected at the DB level.
- `tests/integration/stock-aggregation.test.ts` — current stock query returns sum-of-in minus sum-of-out, grouped by (site, material, grade).

**Phase 4 Playwright walkthrough:**

```
PRE: Phase 2 + Phase 3 done. A visit settled and is now in awaiting_stock_intake.

PURCHASE INTAKE:
1. Log in as inv1 → /inventory. Queue shows awaiting-intake visits.
2. Open the visit → "Receive into stock" form: confirm weight + grade (pre-filled from analysis), edit if needed, click "Take into stock".
3. State transitions to "stocked". A new stock_movements row exists. Audit trail records it.
4. /inventory home now shows the updated stock level for (site × material × grade).

BULK SALE (pending → owner approves):
5. Log in as inv1 → "Bulk sales" → "+ New bulk sale".
6. Fill buyer name, material (with available grades), weight (up to current stock), unit price.
7. Submit. Bulk sale created with approval_status=pending. Stock NOT yet decremented.
8. Log out, log in as owner1 → /owner. Pending bulk sales board shows it.
9. Open it → click "Approve". A new stock_movements row of direction='out' is written; stock decrements.
10. Audit log: bulk_sale_created, then bulk_sale_approved.

INVARIANT CHECK:
11. Try to create a bulk sale exceeding current stock for that grade. UI form should prevent it; DB constraint should reject if UI is bypassed.

REJECTION (optional Playwright):
12. Inventory Manager creates a pending bulk sale.
13. Owner rejects with a note. Stock unchanged. Inventory Manager's queue shows status=rejected.
```

**Manager checkpoints in Phase 4:**

1. **Stock balance is a critical invariant.** The DB-level CHECK or trigger guard is non-negotiable; do not rely on UI validation alone.
2. **Bulk sale received_amount.** Per memory `not-a-full-financial-system`, the app DOES NOT track buyer payments. The `received_amount` field is optional and owner-only; it's a single denormalized field, not a payments ledger like Phase 3.
3. **Consumables scope.** If the company doesn't actually track consumables operationally, drop them from Phase 4 entirely. YAGNI.
4. **Phase 5 dashboard depends on this.** Owner's dashboard (Phase 5) shows live stock-by-grouping and bulk-sale velocity — Phase 4 must produce the right shape for that.

---

# Phase 5 — Owner Cross-Site Dashboard ✅ DONE

**Goal:** Single dashboard at `/owner` aggregating everything across the 3 sites. Filters by site, date range, material type. Drill-down to individual visits.

**Status:** `DONE`. Design system primitives, full owner dashboard with all 9 tiles + filters, cross-site search, and all role screen retrofits committed on `phase-5-dashboard`.

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-5-owner-dashboard-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-5-owner-dashboard.md`
- Suggested branch: `phase-5-dashboard` — **branch from `phase-4-inventory`** (or from main if Phase 4 has been merged); the dashboard aggregates across all prior phases' tables.

**What Phase 5 builds:**

A redesigned `/owner` page that includes (in some layout):

| Tile / section | Source |
|---|---|
| Visit volume per site × state (funnel chart or kanban-style) | `visits` aggregate |
| Money in/out per site × period | `payments` aggregate |
| Outstanding balances per visit (top N) | `payments` running totals |
| Rejection rate (no-agreement / total agreed+rejected) | `visits` + `pricing` |
| Processing throughput (machines used per day per site) | `processing_machine_usage` + `processing_records.completed_at` |
| Live stock by site × material × grade | `stock_movements` aggregated |
| Machine utilization (hours/bags/kg processed per machine per period) | `processing_machine_usage` + `machines` |
| Consumables on-hand per site | `consumables` |
| Awaiting-owner queue (existing Phase 2 board) | `visits` state IN ('awaiting_gate_exit'); `bulk_sales` pending |

Plus:
- Filters: site (all / specific), date range (default last 30 days), material type
- Drill-down: clicking any tile opens a filtered list → individual visit timeline (the shared `/visits/[id]` from Phase 2)
- Cross-site search (supplier name, vehicle plate, visit id)

**This is also where UI polish happens.** Until now, every screen uses raw Tailwind without a design system. Phase 5 should establish:
- Typography scale
- Color tokens (status badges, semantic colors)
- Card / table / form primitive components in `src/components/ui/`
- Brand header (MAGNETIC JOEZION NIG. LTD) per the design spec's PDF branding requirement (Phase 6)

Existing role screens (Gate, Processing, Receiving, Manager, Accounting, Inventory, Visit Detail) should be retrofitted to the new design system as part of Phase 5 — not a separate phase.

**Planning step (brainstorm with owner before building):**

1. **What metrics matter day-to-day?** Owner says he wants oversight — but oversight of *what*? Throughput? Margins? Theft signals? Manager should sit with the owner and identify the 3-5 questions he wants answered every morning.
2. **Aggregation periods.** Daily / weekly / monthly views? Default to last 30 days, but owner may want "yesterday" as the headline.
3. **Mobile-responsive?** Owner may check the dashboard from a phone. Confirm: does the dashboard need a mobile layout or is desktop-only fine?
4. **Date pickers.** Standard or business-specific (e.g., financial weeks)?
5. **Performance.** With 3 sites and growing data, some aggregates need indexed materialized views. Decide if Phase 5 includes the materialized view + scheduled refresh, or if the live aggregates are good enough.

**Testing strategy:**

- `tests/lib/dashboard-queries.test.ts` — pure-SQL query functions return correct aggregates against seeded data.
- `tests/rls/dashboard-access.test.ts` — non-owner cannot read the `/owner` API endpoints; cross-site aggregates require owner role.
- `tests/integration/drill-down.test.ts` — clicking a tile produces a correctly filtered list.
- `tests/ui/{dashboard-tiles,filters,drill-down}.test.tsx` — component tests for each tile.

**Phase 5 Playwright walkthrough:**

```
PRE: Phases 1-4 done. At least 10 visits seeded across 2-3 sites with various states/materials/payments.

1. Log in as owner1 → /owner. Dashboard loads with default 30-day filter, all sites.
2. Verify each tile shows realistic numbers.
3. Click "Visit volume" tile → drill-down list opens, scoped to last 30 days.
4. Apply site filter "Osun only" → all tiles refresh; visit volume now Osun-only.
5. Change date range to "last 7 days" → tiles refresh.
6. Click "Outstanding balances" → list of visits with positive balance, sorted by amount.
7. Click a visit → /visits/[id] opens, full timeline visible.
8. Type a supplier name in cross-site search → results from any site.
9. Log out, log in as proc1 → confirm /owner returns 404 or redirects to /processing.
```

**Manager checkpoints in Phase 5:**

1. **Resist scope creep.** Owner will ask for "just one more chart." Get the must-haves done first; charts are easy to add.
2. **Design system consistency.** Don't ship Phase 5 with the new design and Phase 2 screens still looking like raw HTML. Retrofit at the same time.
3. **Performance budget.** Set a 1-second response time budget for dashboard load. If queries take longer, switch to materialized views before adding more tiles.

---

# Phase 6 — Branded PDF Export ✅ DONE

**Goal:** Every subprocess record can be exported as a branded PDF (MAGNETIC JOEZION NIG. LTD header, logo, formatted data) from the relevant detail page.

**Status:** `DONE`. 7 PDF templates, `/api/pdf/[type]/[id]` route with auth + access control, PdfDownloadBar on visit detail, receipt links on bulk-sales page. All committed on `phase-6-pdf-export`.

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-6-pdf-export-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-6-pdf-export.md`
- Suggested branch: `phase-6-pdf-export` — **branch from `phase-5-dashboard`** (or from main if Phase 5 has been merged); PDFs render data from every prior phase.

**What Phase 6 builds (per spec §11):**

Seven PDF templates, each generated server-side via a route handler (`/api/pdf/[type]/[id]`) using a Node.js PDF library (recommendation: `@react-pdf/renderer` for React-style template composition):

1. **Gate intake slip** — visit ID, supplier, vehicle, declared material, entry path, gate user, timestamp.
2. **Processing report** — machines used, measurements, line costs, total fee, dates, processing user.
3. **Analysis report** — XRF readings, grade, purity, sample ID, QC observations, analyst, timestamp.
4. **Pricing / agreement sheet** — unit price, purchase amount, agreement decision, payment terms, manager (+ owner if overridden).
5. **Payment statement** — full payments ledger for a visit, running balance, deduction flag.
6. **Bulk sale receipt** — buyer, material, weight, unit price, total, owner approval signature.
7. **Full visit dossier** — all of the above plus the audit trail, single multi-page PDF.

**Common elements:**
- Branded header with logo + "MAGNETIC JOEZION NIG. LTD" + site name
- Footer with generation timestamp + unique document hash
- Page numbers
- Tables with consistent typography (matches Phase 5 design system)

**Access control:** Each PDF endpoint enforces the same RLS scope as the corresponding screen — non-owner can only generate PDFs for their site; owner can generate any.

**Planning step (brainstorm with owner before building):**

1. **Logo and brand assets.** Get the actual company logo file from owner (vector preferred). If no logo exists, design step happens before Phase 6.
2. **Approval signatures.** Pricing-overrides and bulk-sale approvals can show "Approved by [Owner Name]" — do they need a literal signature image (handwritten scan) or just the name + timestamp?
3. **Currency formatting.** NGN with full symbol or just "₦"? Two decimal places always?
4. **Language.** English only (the briefing was English) or bilingual?
5. **PDF storage.** Generated on demand and streamed to the browser, or saved to Supabase Storage for archive? Recommendation: on-demand for now, archive later if compliance demands it.

**Testing strategy:**

- `tests/integration/pdf-routes.test.ts` — each route returns a 200 with `application/pdf` content type for an authorized user.
- `tests/rls/pdf-access.test.ts` — non-owner cannot fetch a PDF for another site's visit.
- `tests/ui/pdf-link.test.tsx` — each detail page renders a "Download PDF" button visible to authorized roles.

PDF content verification is tricky to fully automate — use snapshot testing on the rendered HTML pre-PDF, or compare file size / page count as sanity checks.

**Phase 6 Playwright walkthrough:**

```
PRE: Phases 1-5 done. A fully-completed visit (gate intake → stocked) exists with payments recorded.

1. Log in as owner1 → /visits/[id] for the completed visit.
2. Click "Download PDF" → "Full visit dossier" → PDF opens in browser.
3. Verify: header has company name + logo + Osun site; each section is present (gate, processing, analysis, pricing, payments, intake); audit trail at the end; footer has document hash.
4. Click on individual stage cards → "Download Gate intake slip" → single-page PDF with just that subprocess.
5. Log in as gate1 → visit the same /visits/[id]. "Download Gate intake slip" is visible (gate's own work) but "Download Pricing sheet" is hidden or unauthorized.
6. Try the URL directly: /api/pdf/pricing/[id] as gate1 → 403.
```

**Manager checkpoints in Phase 6:**

1. **Branding consistency.** PDFs are external-facing documents. If a supplier sees a misaligned logo, it reflects on the business. Get the design right.
2. **Document hash.** Each PDF should include a unique identifier (UUID or content hash) so a printed receipt can be matched back to its source visit later.
3. **Audit log.** Generating a PDF should optionally write a `transaction_events` row of type `pdf_exported` so the system records who printed what (deferred from Phase 2 as not in scope). Decide with owner.

---

# Phase 7 — Gate Role Removal ✅ DONE

**Goal:** Remove the `gate` role and all gate-specific processes from the system. Visits enter the pipeline directly at processing; no gate intake stage exists.

**Status:** `DONE`. Migration 0017, processing-owned visit creation, removed gate route/PDF/exit-authorization flow, and full test suite (35 files, 140 tests) committed on `phase-7-gate-removal`. The `processing` role now creates visits via `/processing/intake`. No-agreement visits go `pricing → exited` directly.

**Implementation note:** The `app_role` Postgres enum keeps an orphan `'gate'` value (dropping it would CASCADE-drop every RLS policy). `gate` is removed from `src/lib/auth/roles.ts` so it can't be provisioned, and every gate policy/table/state/flow is gone. Migration 0017 narrows the `visits.state` CHECK (removes `at_gate_in`/`awaiting_gate_exit`), rewrites the state-machine + pricing + audit triggers, drops `gate_exit_authorizations`, and swaps the visits INSERT/UPDATE RLS from gate to processing.

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-7-gate-removal-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-7-gate-removal.md`
- Suggested branch: `phase-7-gate-removal` — **branch from `phase-6-pdf-export`**

---

**What Phase 7 removes / changes:**

*Database:*
- Remove `gate` from the `app_role` enum (migration: drop dependent objects, recreate enum without `gate`, restore objects).
- Drop `gate_exit_authorizations` table and all its RLS policies, triggers, and indexes.
- Remove all RLS policies referencing `'gate'` role on any table.
- Remove `awaiting_gate_exit` from the visit state enum and the state-machine validator trigger. Update the no-agreement path: `pricing (no agreement) → exited` directly (no intermediate authorization step).
- Remove `gate_exit_authorized` event type from `transaction_events` check constraint.
- Remove `at_gate_in` visit state from enum and state machine.

*Server-side logic:*
- Remove `gate` from `src/lib/auth/roles.ts` (`ROLES` array and `ROLE_HOME` map).
- Remove `gate` home redirect from `src/middleware.ts`.
- Remove gate-intake state from the TypeScript state-machine mirror (`src/lib/visits/state-machine.ts`): remove `at_gate_in`, `awaiting_gate_exit`; update `TERMINAL_STATES`.
- Add visit-creation capability to `processing` role: insert RLS policy allowing `processing` role to INSERT visits on their own site.

*UI screens:*
- Delete `src/app/(gate)/` directory entirely (`/gate`, `/gate/intake`, and all sub-routes).
- Remove `GateIntakeCard` from the visit timeline (`VisitTimeline.tsx`) — the timeline now starts at processing.
- Remove `ExitAuthorizationCard` from the visit timeline (no owner authorization step).
- Remove "Awaiting release" section from `/gate` home (route gone).
- Remove "Awaiting gate sign-off" section from `/owner` dashboard (state no longer exists).
- Remove "Gate intake" PDF link from `PdfDownloadBar`.
- Delete `src/lib/pdf/templates/gate-intake.tsx` and remove it from the route handler.
- On `/visits/[id]`, update the shared detail page to not fetch `gate_exit_authorizations`.
- Add visit-creation form to `/processing` page: supplier search + vehicle plate + material type at the top, before the processing card.

*Tests:*
- Delete `tests/rls/gate-exit-authorizations.rls.test.ts`.
- Delete all test cases referencing `gate` role, `at_gate_in` state, `awaiting_gate_exit` state, `gate_exit_authorized` event.
- Update `tests/integration/no-agreement-exit.test.ts` — path is now `pricing (no_agreed) → exited` directly; remove owner-authorization and gate-release steps.
- Update `tests/state-machine/transitions.test.ts` — remove gate states from allowed-transitions matrix.
- Update `tests/state-machine/invariants.test.ts` — remove gate-related invariant tests.
- Update `tests/lib/state-machine.test.ts` — TS mirror must match updated DB allowed set.
- Update `tests/integration/gate-intake-action.test.ts` — rename/rewrite as `processing-intake-action.test.ts`.
- Update `tests/integration/happy-path-*.test.ts` — pipeline starts at processing, not gate.

*PDF export (Phase 6 dependency):*
- Remove the **Gate intake slip** PDF template — there is no gate intake record.
- Remove the gate intake section from the **Full visit dossier** (`full-dossier.tsx`).
- Update the dossier page structure (section numbering shifts).

*Owner dashboard (Phase 5):*
- Remove "Awaiting gate sign-off" tile/queue from `/owner` (state no longer exists).

---

**Planning step (confirm before building):**

| Decision | Status |
|---|---|
| Who creates visits? | ✅ **Confirmed: processing role** — supplier search + vehicle plate captured at processing intake |
| Supplier lookup | Moves to `/processing` page top-of-form search (same fuzzy search as old gate intake) |
| Vehicle plate | Still captured per-visit at processing intake (snapshot, not a FK) |
| No-agreement exit | Confirmed: `pricing (no_agreed) → exited` directly, no authorization step |
| Gate employee accounts | All provisioned `gate` accounts become invalid after migration; owner must delete or re-provision them |

---

**Testing strategy:**

| Suite | What to verify after gate removal |
|---|---|
| RLS | No policy references `gate` role; `gate_exit_authorizations` table is gone |
| State machine | `at_gate_in` and `awaiting_gate_exit` absent from allowed-transitions; `pricing → exited` direct passes |
| Integration | Happy path starts at processing (supplier + vehicle captured there); no-agreement ends at `exited` without authorization |
| Audit | No `gate_exit_authorized` events written anywhere |
| UI | `/gate` returns 404; no "Authorize exit" button on visit detail; no gate intake PDF link |

---

**Phase 7 Playwright walkthrough:**

```
PRE: Phases 1–6 done and passing. Run npx supabase db reset after applying Phase 7 migrations.

GATE ROUTE GONE:
1. Visit http://localhost:3000/gate → 404 / redirect to /login.
2. Log in as owner1, try /gate → same result. Route truly gone.

VISIT CREATION (new flow — processing role):
3. Log in as proc1 → /processing.
4. A "New visit intake" form appears at the top: supplier search, vehicle plate, material type.
5. Search for a supplier by phone (no match) → fill name + phone + vehicle plate + material type → Submit.
6. Visit created in state "in_processing". Processing card appears immediately.
7. Fill in machines + measurements → submit → visit transitions to "in_receiving".

NO-AGREEMENT PATH:
8. Walk visit through receiving → pricing. Manager marks "No agreement".
9. Visit state transitions directly to "exited". No "awaiting_gate_exit" state appears.
10. Owner dashboard has no "Awaiting gate sign-off" queue.

PDF EXPORT:
11. On a completed visit, download the Full visit dossier. Confirm no "Gate intake slip" section.

PASS criteria: /gate 404; pipeline starts at processing; no-agreement → exited directly; owner dashboard has no gate queue; PDF dossier has no gate section.
```

---

**Manager checkpoints in Phase 7:**

1. **Enum migration is irreversible once on cloud.** Test on a fresh local `db reset` before pushing to cloud.
2. **Existing gate accounts break on login.** Any provisioned `gate` employee accounts in the cloud DB will fail after migration. Delete or re-provision them before deploying.
3. **PDF dependency.** Phase 6 shipped a gate-intake PDF template. Phase 7 must delete it in the same branch.
4. **State-machine TS mirror.** Update both DB migration and `src/lib/visits/state-machine.ts` in the same commit to keep tests green.
5. **Supplier search moves to processing.** The processing intake form needs the full SupplierSearch component from the old `/gate/intake` — reuse, don't rewrite.

---

# Phase 8 — Inventory Management UI Dashboard 🎨 DONE

**Goal:** Build a gorgeous, highly intuitive, modern Inventory Management Dashboard as the primary operator interface — replacing raw Tailwind screens with a production-grade SaaS-quality UI.

**Status:** `DONE`. App shell (sidebar + header), dark mode, role-aware nav, and the redesigned owner dashboard (KPI cards + inventory table + activity feed) committed on `phase-8-ui-dashboard`. Build clean — 20 routes. 150 tests pass (incl. new role-aware nav suite).

**Implementation notes:**
- **Shell:** `src/components/shell/` — `AppShell` (wraps every authenticated route, bypassed for `/login` + `/set-password`), `Sidebar` (role-aware nav from `src/lib/nav.ts`, brand, user profile + sign-out, mobile slide-over), `Header` (Cmd-K-style search → `/owner/search` for owner, notification bell badge = pending bulk sales, hamburger, dark toggle), `ThemeProvider` + `DarkModeToggle` (next-themes, class-based dark mode persisted to localStorage).
- **Design system:** `@theme` brand tokens + `@custom-variant dark` in `globals.css`; zinc/emerald palette; `lucide-react` icons. Shared `ui/{card,badge}` got `dark:` variants.
- **Dashboard components:** `src/components/dashboard/{KpiCard,InventoryTable,ActivityFeed}`. `InventoryTable` does client-side filter (material/site) + sort + pagination with a "+ New Visit" button (→ `/processing/intake`). Est. stock value uses average approved bulk-sale unit price per material.
- **New visit creation** ("+ New Visit") maps to the processing intake form (gate was removed in Phase 7).
- **Logout:** `src/app/auth-actions.ts` `logout()` server action (clears Phase 1 backlog item).
- **Tests:** UI logic extracted to a pure `src/lib/nav.ts` module tested by `tests/lib/nav.test.ts` (vitest runs node-only `.test.ts`, so no RTL/jsdom infra was added). Component-level RTL tests from the original brief were intentionally skipped in favor of the testable nav module.

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-8-ui-dashboard-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-8-ui-dashboard.md`
- Suggested branch: `phase-8-ui-dashboard` — **branch from `phase-7-gate-removal`**

---

**Design brief:**

> Build a gorgeous, highly intuitive, and modern Inventory Management Dashboard using Next.js (App Router), React, and Tailwind CSS v4.
>
> **Design Aesthetic:** Clean, minimalist, modern SaaS (Linear / Stripe). Default light mode with rich dark mode toggle. Zinc/slate base (`bg-zinc-50` / `dark:bg-zinc-950`) with emerald or indigo accent for primary actions. Clean sans-serif typography, subtle borders, micro-interactions on hover, smooth transitions. Lucide React icons.
>
> **Layout:** Sticky responsive sidebar + main content area.
> - Sidebar: Logo/Branding, role-aware nav links, User Profile at the bottom.
> - Header: Global search bar (Cmd+K), notifications bell with badge, Dark/Light toggle.
>
> **Main Dashboard Features:**
> - KPI Metrics Row: Total Items on hand and Total Stock Value (₦). Trend percentages (+12% this week).
> - Inventory Table: Beautifully formatted table — Material, Grade, Site, Stock (kg), Est. Value. Filter by Material + Site dropdowns, Sort dropdown, "+ New Visit" primary button (creates a new supplier visit / processing intake). Alternating row hovers, clean pagination.
> - Activity Pane: "Recent Stock Activities" feed showing actor, weight, item name, and direction for recent `stock_movements` rows.

**Design tokens (add to `globals.css`):**

```css
@theme {
  --color-brand-primary: oklch(55% 0.18 160);   /* emerald accent */
  --color-brand-subtle:  oklch(96% 0.04 160);
  --color-surface:       oklch(99% 0 0);
  --color-border:        oklch(90% 0 0 / 80%);
  --radius-card:         0.75rem;
}
```

---

**What Phase 8 builds:**

New shared components (`src/components/ui/` extensions):

| Component | Purpose |
|---|---|
| `Sidebar` | Sticky nav with role-aware links, branding, user profile, mobile collapse |
| `Header` | Global Cmd+K search, notification bell (unread count from awaiting-owner queue), dark/light toggle |
| `KpiCard` | Metric tile: label, value, trend pill (Total Items, Total Stock Value) |
| `InventoryTable` | Data table: Material, Grade, Site, Stock (kg), Est. Value. Filter + sort + pagination. "+ New Visit" button |
| `ActivityFeed` | Chronological `stock_movements` feed: actor, weight, item, in/out direction |
| `DarkModeToggle` | Theme toggle via `next-themes`, persisted to `localStorage` |

Layout shell update: wrap all authenticated routes in `Sidebar` + `Header`.

Responsive breakpoints:
- `< 768px`: sidebar collapses to hamburger sheet.
- `768px–1024px`: sidebar icons + labels, table collapses less-critical columns.
- `> 1024px`: full layout.

---

**Planning step (confirm before building):**

| Decision | Question |
|---|---|
| Notification content | Bell badge count — awaiting-owner queue only (gate exits + pending bulk sales), or other events? |
| Cmd+K search scope | Supplier name, vehicle plate, visit UUID across all sites (owner) or scoped to role's data? |
| Mobile priority | Which roles use the app on mobile? Gate removed; processing/receiving users may be on tablet at site |
| "+ New Visit" placement | Appears on the inventory table toolbar for processing role (and owner). Other roles see it too? |

---

**Testing strategy:**

| Suite | What to verify |
|---|---|
| `tests/ui/sidebar.test.tsx` | Role-aware links render correctly for each role; mobile collapse works |
| `tests/ui/kpi-cards.test.tsx` | Both cards render correct label/value/trend |
| `tests/ui/inventory-table.test.tsx` | Filter narrows rows; sort changes order; pagination works; "+ New Visit" visible to processing + owner |
| `tests/ui/activity-feed.test.tsx` | Feed renders stock_movements rows with correct actor, weight, item, direction |
| `tests/ui/dark-mode.test.tsx` | Toggle switches `html` class to `dark`; persists in localStorage |

---

**Phase 8 Playwright walkthrough:**

```
PRE: Phases 1–7 done. npm run dev.

LIGHT MODE (default):
1. Log in as owner1 → /owner. Dashboard loads with zinc background, emerald accent.
2. Verify 2 KPI cards: Total Items and Total Value (₦). Both show trend percentages.
3. Scroll to Inventory Table — Material, Grade, Site, Stock (kg), Est. Value columns visible.
4. Click "+ New Visit" → opens processing intake form (supplier search + vehicle plate + material).
5. Filter by material — rows narrow correctly.
6. Check Activity Feed — shows in/out stock movement events with actor, weight, item name.

DARK MODE:
7. Click dark/light toggle in header → background switches to zinc-950.
8. Reload → dark mode persists (localStorage).
9. Toggle again → light mode restored.

MOBILE (resize to 375px):
10. Sidebar collapses to hamburger.
11. Tap hamburger → sidebar slides in as sheet.
12. Tap nav link → sidebar closes, correct page loads.

ROLE ISOLATION:
13. Log out, log in as proc1 → /processing. Sidebar shows Processing-relevant links only.
14. Try /owner directly → redirected to /processing.

PASS criteria: 2 KPI cards render; inventory table has correct columns; "+ New Visit" opens processing intake; activity feed shows stock movements; dark mode persists; mobile sidebar works; role nav hides unauthorized links.
```

---

**Manager checkpoints in Phase 8:**

1. **Last phase before merge + deploy.** UI must be polished enough for real users. Show the owner the design before writing production code.
2. **Don't ship half-finished components.** Use a "Coming soon" stub rather than a broken form.
3. **Performance.** Inventory table may load many rows — implement cursor-based pagination; never `SELECT *` without `LIMIT`.
4. **Design system consistency.** After Phase 8, all screens from all prior phases should use the same `src/components/ui/` primitives.

---

# Phase 9 — Domain Refinements: QC Role, Multi-Material Batches, Advances & Lot-Tracked Bulk Sales 🧪 NOT STARTED

**Goal:** Evolve the domain model to match how the business actually runs: split out a dedicated **QC** role that owns XRF analysis (separate from Receiving's magnetic analysis), let a single supplier bring **multiple materials in one batch**, add a **supplier advances** ledger, redesign **consumables** as a categorized expense log, and rebuild **bulk sales** on **lot-tracked stock** with the supplier/average-cost-price breakdown.

**Status:** `NOT STARTED`. **Branch from `phase-8-ui-dashboard`** → suggested branch `phase-9-domain-refinements`.

> ⚠️ **This phase supersedes earlier design decisions.** When it lands, update `CLAUDE.md`:
> - Roles become **7** again, but the new 7th is **`qc`** (not `gate`, which was removed in Phase 7): `processing · receiving · qc · manager · accounting · inventory · owner`.
> - The rule *"Receiving and analysis are one role/record"* is **no longer true** — Receiving records weight + **magnetic** analysis; **QC** records the **XRF** analysis as a separate, access-restricted record.
> - The Phase 4 bulk-sale schema (single material/grade/weight per sale) is **replaced** by the lot-selection model below.
> - A **Visit** is no longer one supplier + one material; it is one supplier + **one batch of many material line items**.

**Artifacts (when planning):**
- Spec to create: `docs/superpowers/specs/YYYY-MM-DD-phase-9-domain-refinements-design.md`
- Plan to create: `docs/superpowers/plans/YYYY-MM-DD-phase-9-domain-refinements.md`
- Suggested branch: `phase-9-domain-refinements` — branch from `phase-8-ui-dashboard`
- Migrations start at `0018_*` (last shipped migration is `0017_gate_removal.sql`)

---

**Confirmed decisions (from owner, captured before planning):**

| Decision | Confirmed answer |
|---|---|
| QC in the pipeline | **New blocking stage after Receiving:** `in_processing → in_receiving (magnetic) → in_qc (XRF) → pricing`. Pricing itself is **optional** (see workstream E). |
| Multi-material batch | **Per-material line items.** One visit/batch holds many material lines; each line carries its own weight, magnetic analysis, XRF result, and (optional) price. |
| Bulk-sale stock model | **Lot-tracked.** Each purchase intake becomes a distinct, identifiable lot (supplier, material, weight, cost price). Bulk sale selects specific lots and marks them SOLD. Replaces the fungible grade-bucket ledger. |
| Supplier advances | **Standalone records.** Advances are their own approved ledger; they are **not** auto-netted against purchase amounts. Owner reconciles manually (consistent with "this is not a full financial system"). |
| "maker" in the advances brief | Read as **manager** (typo). Advances are **recorded by the manager**; **approved by owner, manager, or accountant**. |

---

**What Phase 9 builds — by workstream:**

### A. QC role

- Add `'qc'` to the `app_role` enum (`0018_qc_role.sql`). Adding an enum value is safe (unlike the Phase-7 *removal* problem) — no CASCADE.
- Add `qc` to `src/lib/auth/roles.ts` (`ROLES`, `ROLE_HOME` → `/qc`) and the middleware home-redirect map. **Roles single source of truth stays in `roles.ts`.**
- Owner can provision a `qc` employee at `/owner/employees` (the existing provisioning form already reads `ROLES`; verify the new role appears).
- New `/qc` route group with a queue of visits in state `in_qc`.

### B. Multi-material batches

- New table `visit_materials` (the per-line spine of the batch):
  ```
  visit_materials
    id uuid PK
    visit_id FK -> visits
    material_type_id FK -> material_types
    weight_kg numeric(12,3)            -- receiving-recorded output weight for THIS material
    magnetic_analysis text             -- receiving-recorded (free text / structured later)
    receiving_comment text
    created_at, recorded_by
  ```
- `visits` keeps `supplier_id`, `site_id`, `vehicle_plate`, `entry_path`, `state` — but **material moves off the visit row onto `visit_materials`**. The old single `material_type` declaration on the visit becomes a batch of lines.
- Receiving screen lets the user **add multiple material lines** to one visit before advancing it to `in_qc`.
- Downstream records (XRF, pricing, stock lots) reference a **`visit_material_id`**, not the visit directly — so monazite and zircon in the same batch are analyzed and priced independently.

### C. Receiving redesign (magnetic analysis)

- Receiving records, **per material line**: supplier (inherited from the visit), material type, **weight in kg**, **magnetic analysis**, and a **comment box**.
- The old `analysis_records` (which mixed weight + grade + XRF) is split: weight + magnetic + comment live on `visit_materials` (Receiving's lane); XRF moves to `xrf_records` (QC's lane, workstream D).
- Advancing a visit `in_receiving → in_qc` requires ≥1 material line with a weight.

### D. QC XRF records (access-restricted)

- New table `xrf_records`:
  ```
  xrf_records
    id uuid PK
    visit_material_id FK -> visit_materials   -- one XRF result per material line
    result text                               -- free-text XRF write-up typed by QC
    submitted boolean NOT NULL DEFAULT false
    recorded_by FK -> profiles (qc)
    created_at, updated_at
  ```
- QC screen shows, per line: **supplier, material type, weight**, and a **free-text result box** to type and submit the XRF analysis.
- **RLS visibility rule (critical):** a submitted `xrf_records.result` is readable **only by `owner` and `manager`** (and the `qc` author who wrote it). `receiving`, `accounting`, `inventory` **cannot** read XRF results. This is a column/row visibility constraint enforced in Postgres, not just hidden in the UI.
- Submitting all lines' XRF advances the visit `in_qc → pricing`.
- **Branded PDF:** an XRF analysis report (per visit or per line) is exportable as a branded PDF (extends the Phase 6 PDF system; access-scoped to owner/manager).

### E. Optional pricing (manager or owner)

- Pricing a QC'd line is **optional**. Either **manager or owner** may assign a `unit_price` to a `visit_material` line.
- Pricing model moves to **per-line**: `pricing` (or a new `material_pricing`) keys on `visit_material_id`, with `unit_price`, `purchase_amount = unit_price × weight_kg`, agreement decision, payment terms (Owner's call, transcribed — unchanged rule).
- Because pricing is optional, the pipeline must handle a visit that is **never priced**: after QC, the manager/owner can (a) price + agree → `in_accounting` → … → `stocked`, (b) record no agreement → `exited`, or (c) leave it unpriced as an analysis-only record. **Confirm the exact terminal behavior for unpriced visits during planning.**

### F. Supplier advances

- New table `advances`:
  ```
  advances
    id uuid PK
    supplier_id FK -> suppliers          -- advances attach to the global supplier, not a visit
    purpose text NOT NULL
    amount_naira numeric(14,2) NOT NULL CHECK (amount_naira > 0)
    recorded_by FK -> profiles            -- normally the manager
    approval_status text CHECK (approval_status IN ('pending','approved','rejected'))
    approved_by FK -> profiles NULL        -- owner, manager, or accountant
    approved_at timestamptz NULL
    created_at, comment text
  ```
- **Insert:** manager (primarily). **Approve:** owner, manager, or accountant (RLS allows those three roles).
- **Standalone** — advances are tracked and reportable but **not** auto-deducted from any `purchase_amount`. (If the owner later wants netting, that's a separate phase.)
- Surfaced on the owner dashboard (outstanding advances per supplier) and exportable as a branded PDF.

### G. Consumables redesign (categorized expense log)

Replace the Phase 4 `consumables` (name + on_hand + unit) with an expense-style log:
```
consumables                              -- redesigned
  id uuid PK
  site_id FK -> sites
  name text NOT NULL
  category text NOT NULL CHECK (category IN (
    'fuel_lubricants','utility','wages','repairs_maintenance',
    'stationaries','transport','toiletries','others'))
  entry_date date NOT NULL DEFAULT current_date
  comment text
  recorded_by FK -> profiles
  created_at
```
- Inventory Manager (+ Owner) add a consumable: **name, category (the 8-value enum above), date, comment box**.
- Drop the old `consumable_movements` on-hand ledger unless the owner still wants quantity tracking (confirm in planning — the new brief describes a categorized log, not a stock counter).

### H. Lot-tracked bulk sales

This replaces the Phase 4 bulk-sale model.

- **Stock becomes lot-tracked.** When the Inventory Manager takes a purchased material line into stock, it creates a **lot**:
  ```
  stock_lots
    id uuid PK
    site_id FK -> sites
    material_type_id FK -> material_types
    supplier_id FK -> suppliers           -- who supplied this lot
    ref_visit_material_id FK NULL          -- provenance back to the batch line
    weight_kg numeric(12,3) NOT NULL
    cost_price_per_kg numeric(12,2)        -- what the company paid per kg for this lot
    status text CHECK (status IN ('available','sold')) DEFAULT 'available'
    created_at, recorded_by
  ```
- **Bulk sale = selecting available lots of one material**, then:
  ```
  bulk_sales (revised)
    id uuid PK, site_id, material_type_id, buyer_name, buyer_phone
    approval_status ('pending','approved','rejected'), approved_by, approved_at
    total_weight_kg, total_cost_price, avg_cost_price_per_kg   -- snapshotted on approval
  bulk_sale_lots
    bulk_sale_id FK, stock_lot_id FK        -- the lots included in this sale
  ```
- **Execution (matches the owner's spec):** on selecting lots, the UI/PDF tabulates per lot — **Supplier · Weight (kg) · Price (₦) · Total Amount (₦)** where `Total = Weight × Price` — sums **Total Weight** and **Total Cost Price**, and computes **Average Price per kg = Total Cost Price ÷ Total Weight**. On Owner approval, each selected lot flips `status='available' → 'sold'` (it can't be sold again) and the bulk sale row snapshots the totals.
- **Owner approval still required** (unchanged rule from Phase 4). A lot already `sold` cannot be re-selected — enforced at the DB level, not just the UI.
- **Branded PDF (bulk sale breakdown)** must render exactly this shape:

  ```
  Bulk Sale Material: e.g. Monazite

  | Supplier   | Weight (kg) | Price (₦) | Total Amount (₦) |
  |------------|-------------|-----------|-------------------|
  | Supplier 1 | W1          | P1        | W1 × P1           |
  | Supplier 2 | W2          | P2        | W2 × P2           |
  | TOTAL      | ΣW          | —         | ΣAmount           |

  Cost Price Computation:
  ΣAmount ÷ ΣW = ₦[Average Price per kg]

  Inventory Update:
  [ ] Unselected lot           (Available)
  [x] Selected Supplier 1 lot  (SOLD)
  [x] Selected Supplier 2 lot  (SOLD)
  ```

---

**Planning step (brainstorm with owner before building):**

1. **Unpriced-visit terminal state.** With pricing now optional, what happens to a QC'd visit that's never priced? Stays open indefinitely, auto-closes, or becomes an analysis-only terminal record? (Workstream E.)
2. **XRF visibility edges.** Confirmed owner + manager can read XRF. Can the QC author read their own past submissions? Can accounting see *that* an XRF exists (count) without the result? Lock the exact rule before writing RLS.
3. **Magnetic analysis shape.** Free text now. Will it ever need to be structured (numeric % fields) like XRF? If yes, decide the columns now to avoid a later migration.
4. **Lot cost price source.** Is `cost_price_per_kg` the agreed purchase unit price from pricing (auto-filled) or entered fresh at intake? If a line was never priced, where does its lot cost come from?
5. **Partial-lot sales.** The owner's spec marks whole lots SOLD. Can a buyer take *part* of a lot, or is it all-or-nothing per lot? All-or-nothing is simpler and matches the brief; confirm.
6. **Consumables quantity.** Does the owner still want on-hand quantity tracking, or is the categorized log (name/category/date/comment) the whole feature now? (Workstream G.)
7. **Advance + supplier history.** Should advances appear on the supplier's visit-history view so whoever prices a future visit *sees* the outstanding advance (even though it's not auto-netted)?
8. **Migration of existing data.** Local/cloud already have single-material visits + fungible stock. Decide whether to migrate existing rows into the new line-item / lot tables or treat Phase 9 as a clean cutover (acceptable pre-launch).

---

**Testing strategy:**

| Suite | What to verify |
|---|---|
| `tests/rls/qc.rls.test.ts` | QC reads/writes XRF on own-site visits only; non-owner/non-manager **cannot read** submitted XRF results; owner + manager can |
| `tests/rls/visit-materials.rls.test.ts` | Receiving writes material lines own-site; lines read by the visit's lane; closed-visit lines read-only for non-owner |
| `tests/rls/advances.rls.test.ts` | Manager inserts; owner/manager/accountant approve; other roles blocked; cross-site denied |
| `tests/rls/stock-lots.rls.test.ts` + `bulk-sales.rls.test.ts` | Lot creation by inventory; sale approval owner-only; a `sold` lot can't be re-sold (DB-enforced) |
| `tests/state-machine/transitions.test.ts` | New `in_qc` stage: `in_receiving → in_qc → pricing`; XRF-not-submitted blocks `in_qc → pricing`; optional-pricing terminal paths |
| `tests/integration/multi-material-batch.test.ts` | One visit, ≥2 material lines, each independently weighed / XRF'd / priced |
| `tests/integration/bulk-sale-lots.test.ts` | Select N lots → totals + avg-cost computed correctly; on approval all selected lots flip to `sold`; re-selecting a sold lot rejected |
| `tests/integration/advances.test.ts` | Insert → pending → approve; standalone (no effect on any `purchase_amount`) |
| `tests/lib/state-machine.test.ts` | TS mirror includes `in_qc`; matches DB allowed set |

---

**Phase 9 Playwright walkthrough:**

```
PRE: Phases 1–8 done. npx supabase db reset after applying 0018+ migrations. Owner provisions a qc1 employee.

QC ROLE + MULTI-MATERIAL BATCH:
1. Log in as owner1 → /owner/employees → create qc1 (role: qc, site: Osun).
2. Log in as proc1 → /processing/intake → create a visit for one supplier. Process it → in_receiving.
3. Log in as recv1 → /receiving → open the visit. Add TWO material lines:
   • Monazite: weight 120 kg, magnetic analysis text, comment.
   • Zircon:   weight 80 kg,  magnetic analysis text, comment.
   Advance → state in_qc.
4. Log in as qc1 → /qc → open the visit. For each line, type an XRF result and submit.
   State advances to pricing only after all lines are submitted.
5. Log in as recv1 (or acct1) → open the visit → confirm the XRF result text is NOT visible.
6. Log in as mgr1 → open the visit → XRF results ARE visible. Optionally assign a unit price to one line.
7. Download the branded XRF analysis PDF as owner1; confirm recv1 gets 403 on the same PDF URL.

ADVANCES:
8. Log in as mgr1 → advances screen → record an advance (supplier, purpose, ₦amount) → pending.
9. Log in as acct1 (or owner1) → approve it. Verify it appears on the owner dashboard, and does NOT change any visit's purchase balance.

CONSUMABLES:
10. Log in as inv1 → consumables → add one per a few categories (fuel_lubricants, wages, transport) with date + comment.

LOT-TRACKED BULK SALE:
11. Walk two different suppliers' Monazite lines through to stocked → two available lots (different cost prices).
12. Log in as inv1 → bulk sales → select both Monazite lots → see the per-supplier table + total weight + avg cost/kg. Submit → pending.
13. Log in as owner1 → approve. Both lots flip to SOLD; the bulk-sale PDF matches the owner's required format.
14. Try to start a new bulk sale → the two sold lots no longer appear as available.

PASS criteria: qc role exists; one visit holds multiple independently-analyzed materials; XRF is owner/manager-only; advances are standalone + approved; bulk sale selects lots, computes avg cost, marks them SOLD irreversibly, and prints the branded breakdown.
```

---

**Manager checkpoints in Phase 9:**

1. **Update CLAUDE.md when this lands** — role count, the QC role, and the "receiving = analysis" rule are all changed by this phase. Future Claude agents read CLAUDE.md first.
2. **XRF confidentiality is a security boundary, not UI polish.** It must be enforced in RLS so a curious accountant or inventory user can't read XRF results via the API. Test it explicitly.
3. **Lot model replaces fungible stock.** Once Phase 9 ships, the Phase 4 grade-bucket aggregation on the dashboard must be reworked to read `stock_lots`. Don't leave two competing stock views.
4. **A sold lot is final.** The "can't sell the same lot twice" guard must be a DB constraint/trigger, like the Phase 4 stock-balance invariant — never UI-only.
5. **Advances are not a financial system.** Resist the temptation to auto-net them against purchases; the owner explicitly wants them standalone. Revisit only if he asks.
6. **Migration sequencing.** `visit_materials` + `stock_lots` change the spine of the data model. Apply and verify with `npx supabase db reset` on a fresh DB before pushing anything to cloud.

---

# Phase 10 — Merge to Main 🔀 NOT STARTED

**Goal:** All phase branches merged into `main` in correct order. `main` becomes the single source of truth for the deployable codebase.

**Status:** `NOT STARTED`. `main` currently only has the initial design spec + Phase 1 plan docs. Phase 1's source code lives on `phase-1-foundation`; Phases 2–8 live on their respective branches; Phase 9 (domain refinements) is not yet built. Merge order runs 1 → 9.

**Strategy:**

```
main ─┬── (current: just docs)
      │
      ├── phase-1-foundation (squash-merge or rebase-merge)
      │     ↓
      ├── phase-2-visit-workflow (rebased onto updated main, then merged)
      │     ↓
      ├── phase-3-financial-model
      │     ↓
      ├── phase-4-inventory
      │     ↓
      ├── phase-5-dashboard
      │     ↓
      ├── phase-6-pdf-export
      │     ↓
      ├── phase-7-gate-removal
      │     ↓
      ├── phase-8-ui-dashboard
      │     ↓
      └── phase-9-domain-refinements
```

**Each merge step:**

1. Check out the next phase branch.
2. `git fetch origin && git rebase origin/main` (or `git merge origin/main`).
3. Resolve conflicts (rare if phases are well-isolated).
4. Run the full test suite (`npm run test`) — all phases' tests must pass on the rebased branch.
5. Run `npm run build` — clean.
6. Push: `git push origin <branch>`.
7. Open PR via `gh pr create --base main --title "Phase N: ..."`. Use GitHub PR review even if you're solo — it forces the diff into the open.
8. Merge (squash, rebase, or merge-commit — pick a convention and stick to it; recommendation: rebase-merge to keep linear history).
9. Tag: `git tag phase-N-merged` on main.
10. Delete the phase branch: `git push origin --delete <branch>; git branch -D <branch>`.

**Testing strategy for merges:**

After each merge, run the entire suite (not just the merged phase's tests). Cross-phase regressions are the biggest risk.

```bash
git checkout main
git pull
npx supabase db reset      # apply ALL migrations on fresh DB
npm run test               # full suite, all phases
npm run build              # production build with type-check
```

If any test fails, do not merge the next phase until fixed. Roll back if needed (`git revert <merge-sha>`).

**Phase 10 Playwright walkthrough:**

```
After all merges, on main:

1. Fresh clone the repo.
2. npm install
3. cp .env.example .env.local; fill local Supabase keys
4. npx supabase start
5. npx supabase db reset
6. npm run dev
7. Re-run every phase's Playwright walkthrough end-to-end against the merged main.

PASS criteria: every phase's documented walkthrough still works. If a Phase 2 walkthrough breaks after Phase 8's design-system retrofit, that's a regression — fix on main with a follow-up commit.
```

**Manager checkpoints in Phase 10:**

1. **Don't merge in parallel.** Each phase depends on the previous: Phase 3 → Phase 2's schema; Phase 4 → Phase 3's payments ledger; Phase 5 → Phase 4's stock data; Phase 6 → Phase 5's design system; Phase 7 → Phase 6's stable PDF templates (gate PDF must exist before it can be removed); Phase 8 → Phase 7's final role set; Phase 9 → Phase 8's UI shell (and revises the role set, stock model, and bulk-sale schema). Merge sequentially.
2. **Keep tags.** Every merge tags `main` with the phase name. If a regression appears later, you can bisect by tags.
3. **Migrations are immutable after merge.** Once `0006_material_types.sql` is on main, do not edit it. Add `0007a_*.sql` to fix anything.

---

# Phase 11 — Deploy to Vercel 🚀 NOT STARTED

**Goal:** `main` is live on a Vercel production URL backed by the cloud Supabase project. End users (the family) can access it from anywhere with a browser.

**Status:** `NOT STARTED`. Cloud Supabase project already exists at ref `wevkljmhucuhfqjgeqcb` (keys in `.env.cloud.local`, gitignored). No Vercel project yet.

**Setup steps:**

1. **Push cloud Supabase schema.** Local Supabase has migrations 0001–0006 (or however many phases shipped). Push them:
   ```bash
   npx supabase link --project-ref wevkljmhucuhfqjgeqcb
   npx supabase db push          # applies all local migrations to cloud
   ```
   The Owner has confirmed "Allow new users to sign up" is OFF in the cloud project — verify this in the cloud dashboard before pushing.

2. **Confirm cloud Auth settings:**
   - Email confirmation: OFF (we use synthetic emails)
   - Phone auth: OFF
   - Site URL: will be set after Vercel deploy
   - Redirect URLs: same

3. **Create Vercel project:**
   - Connect GitHub repo `Krysto17/InventorySystem`
   - Framework: Next.js (auto-detected)
   - Build command: `npm run build` (default)
   - Output directory: `.next` (default)
   - Install command: `npm install` (default)

4. **Configure Vercel environment variables** (in dashboard, not committed):
   ```
   NEXT_PUBLIC_SUPABASE_URL          = (from cloud Supabase dashboard)
   NEXT_PUBLIC_SUPABASE_ANON_KEY     = (from cloud Supabase dashboard)
   SUPABASE_SERVICE_ROLE_KEY         = (from cloud Supabase dashboard, server-only)
   SYNTHETIC_EMAIL_DOMAIN            = magneticjoezion.local
   ```
   The service-role key MUST NOT be marked `NEXT_PUBLIC_*` — it stays server-only.

5. **First deploy:**
   - Push `main` → Vercel auto-deploys.
   - Verify build logs are clean.
   - Get the production URL (e.g., `inventory-magnetic-joezion.vercel.app`).

6. **Set Supabase Site URL** to the Vercel production URL (cloud Supabase → Authentication → URL configuration). This is what redirect URLs reference.

7. **Bootstrap first cloud owner:**
   - Local Phase 1 has a bootstrap node script. Run it against the cloud DB:
     ```bash
     NEXT_PUBLIC_SUPABASE_URL=<cloud-url> \
     SUPABASE_SERVICE_ROLE_KEY=<cloud-srk> \
     node scripts/bootstrap-owner.js "Owner Name" owner1 "tempPass!23"
     ```
   - **Bootstrap script must include the Phase 1 cloud-safety guard** — confirm it doesn't blindly wipe auth users. Read the script before running.

8. **Domain (optional):** Add a custom domain in Vercel if the owner wants one.

**Testing strategy:**

- **Cloud smoke test (not committed):** A throwaway script that logs in as owner1, creates a visit at one site, walks it through to `in_accounting`, then deletes it. Verifies the cloud DB + cloud Auth + Vercel deploy all talk to each other.
- **Performance baseline:** Run Lighthouse against the production URL. Capture Time-to-Interactive < 3s as a baseline. Phase 5 dashboard may push this; budget accordingly.
- **Cron / scheduled tasks:** None yet. If Phase 5 adds materialized view refresh, configure Vercel Cron or Supabase scheduled functions and document them here.

**Phase 11 Playwright walkthrough (production):**

```
1. Open the Vercel production URL in an incognito browser.
2. Redirected to /login.
3. Log in as owner1 with the bootstrap password.
4. Forced to /set-password → set a new password.
5. Land on /owner (full UI dashboard from Phase 8).
6. Provision a test processing user.
7. Log out, log in as the test processing user.
8. Confirm the processing intake form loads; create a new visit with supplier + material.
9. Run the Phase 7 happy-path walkthrough end-to-end on production.
10. (Cleanup) Log in as owner, delete the test visit + test processing user.

PASS criteria: every action completes within a reasonable time; no console errors; cookies / sessions persist across redirects; RLS denies cross-site access exactly as it did locally.
```

**Manager checkpoints in Phase 11:**

1. **Service-role key safety.** It must NEVER end up in a `NEXT_PUBLIC_*` env var. If it does, rotate it immediately via Supabase dashboard.
2. **Backup strategy.** Supabase free tier doesn't include automated backups for the cloud DB beyond 7 days. If this goes into real production, upgrade the plan or set up a nightly `pg_dump` to cloud storage.
3. **Monitoring.** Set up at least: Vercel deploy notifications (Slack or email), Supabase health alerts. Add Sentry or similar for client errors if budget allows.
4. **Disaster recovery.** Document how to restore from backup. Document where the `.env.cloud.local` lives offline (a password manager, not committed anywhere).
5. **First real users.** Brief them on WhatsApp before they log in — they will not understand "set-password on first login" if no one warned them.

---

# Quick reference

**Branching strategy (read once; ask Claude to run the commands each time):**

Each phase **branches from the previous phase's branch**, not from `main`. Phases are cumulative — Phase 3 needs Phase 2's tables to test anything, Phase 4 needs Phase 3's payments ledger, etc. Branching from `main` (which doesn't have the previous phase's code until merges happen at the end) means the next phase can't run integration tests against real predecessor code. We learned this the hard way: Phase 2 was originally branched from `main` and had to be cleaned up afterward.

```
main (trunk; only has docs until first merge)
 │
 ├── phase-1-foundation ─────────────────────► PR merges to main first
 │      │
 │      └── phase-2-visit-workflow ───────────► rebase onto main, then PR → main
 │             │
 │             └── phase-3-financial-model ───► rebase onto main, then PR → main
 │                    │
 │                    └── phase-4-inventory
 │                           │
 │                           └── phase-5-dashboard
 │                                  │
 │                                  └── phase-6-pdf-export
 │                                         │
 │                                         └── phase-7-gate-removal
 │                                                │
 │                                                └── phase-8-ui-dashboard
 │                                                       │
 │                                                       └── phase-9-domain-refinements ───► ...
```

### Starting a new phase — copy-paste these commands

When you're ready to start Phase 3, open a terminal in the project folder and run:

```bash
# 1. Switch to the previous phase's branch (the one you're building on top of)
git checkout phase-2-visit-workflow

# 2. Make sure you have its latest version from GitHub
git pull

# 3. Create + switch to a new branch for the phase you're starting
git checkout -b phase-3-financial-model

# 4. Publish the new branch to GitHub (only needed the first time)
git push -u origin phase-3-financial-model
```

For Phase 4: substitute `phase-2-visit-workflow` → `phase-3-financial-model` and `phase-3-financial-model` → `phase-4-inventory`. Same pattern for Phases 5 and 6.

If unsure, ask Claude: **"Start a new branch for Phase N off the previous phase, following BUILD_PHASES.md."** Claude can run the commands for you.

### How phases get merged into main (at the end)

When all phases are built and tested, you (or Claude) run the merges in order: Phase 1 → main first, then Phase 2 → main, etc. Each merge uses a **Pull Request** on GitHub — that's a web page on github.com that shows the diff before you accept it. Detailed steps are in **Phase 9 — Merge to Main** below. You don't need to do this until every phase is built.

**PR convention to keep diffs readable:** when opening a PR for phase N+1, set the PR "base" branch to phase N's branch (not main). GitHub will show only the new phase's changes. After phase N merges into main, ask Claude to "rebase phase N+1 onto main" — that's a one-command cleanup the agent does, not you.

**Tradeoff to manage:** don't let three phases stack unreviewed. Finish reviewing each phase before the next one's code is written.

**Branch naming:**
- `phase-N-<short-name>` for in-progress phases
- `main` for the merged stable trunk
- Tags `phase-N-merged` on `main` after each merge

**File locations:**
- Specs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Plans: `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
- Migrations: `supabase/migrations/NNNN_<topic>.sql` (immutable once merged)
- Tests: `tests/{rls,integration,state-machine,audit,lib,ui}/`
- Business rules: see "Critical business rules" section below (Claude memory on the original author's laptop is not shared with this checkout)

**Cloning the repo:**
- HTTPS: `git clone https://github.com/Krysto17/InventorySystem.git` (simplest; works with GitHub Personal Access Token if push is needed)
- SSH: `git clone git@github.com:Krysto17/InventorySystem.git` (manager's own SSH key on `github.com`)
- Original author's laptop uses a custom SSH alias `github.comB` to disambiguate two GitHub accounts on the same machine; that's specific to that laptop and not required anywhere else.

**Skills the manager's Claude agent should use:**

| Skill | When |
|---|---|
| `superpowers:brainstorming` | Start of each phase, with the owner |
| `superpowers:writing-plans` | After spec is approved, before any code |
| `superpowers:subagent-driven-development` | Per-task implementation with two-stage review |
| `superpowers:test-driven-development` | Built into the per-task subagents |
| `superpowers:requesting-code-review` | Template used by reviewer subagents |
| `superpowers:finishing-a-development-branch` | After all phase tasks pass, before merge |
| `superpowers:using-git-worktrees` | Optional, if you want to keep phase branches isolated |

**Critical local stack commands:**

```bash
npx supabase start           # local Postgres + Auth
npx supabase db reset        # re-apply ALL migrations + seed
npx supabase status          # confirm services running
npm run dev                  # Next.js dev server :3000
npm run build                # production build (type-safety gate)
npm run test                 # full Vitest suite
```

**CLAUDE.md** at the root is the per-session anchor. Read it first if you forget anything about constraints or conventions.

---

## Open questions the manager should raise with the owner

These came up during Phase 2 brainstorming and were either deferred or answered by the owner under time pressure:

1. **Material grade scale.** Free-text or fixed list? Phase 2 left it as free-text on `analysis_records.grade`. Affects inventory grouping in Phase 4.
2. **Processing-fee deduction default.** When the deal includes "deduct processing fee from purchase amount," is that the default for repeat suppliers? Or always set per-visit?
3. **Installment schedules.** Are installments planned in advance or recorded as they happen? Phase 3 currently assumes the latter.
4. **Bulk sale buyers.** Are they tracked as a master list (like suppliers in Phase 2) or inline per sale? Phase 4 currently assumes inline.
5. **Owner override audit.** If Owner edits a closed visit, currently the audit log shows the change but the system doesn't alert anyone. Manager may want to flag these for daily review.
6. **WhatsApp integration.** Out of scope per CLAUDE.md, but the owner may evolve — if WhatsApp Business API ever gets in scope, that's a Phase 9+ decision.
7. **Multi-language.** Currently English. Confirm the staff are comfortable.
8. **Data retention.** How long are completed visits kept queryable? Forever? Auto-archive after N years? Affects database size projections.

Save the answers somewhere durable (e.g. a `docs/business-rules/` folder committed to the repo, or extend this file's "Critical business rules" section). Project memories that live in the original author's Claude config directory are not transferred with the repo, so any decision you want future Claude agents to inherit must be in committed source.

---

## Critical business rules (inlined from the original author's project memory)

These rules came out of the original briefing with the owner and are non-obvious. The manager should verify each one with the owner; they're documented here so future Claude agents starting fresh on a new machine have the same baseline.

### Processing fee is on input — never on output

The processing role does **not** record output weight; that's the receiving facility's job. Processing is a paid service measured against what came IN, not what came out. **If a supplier brings 100 kg that turns out to be mostly sand and the output is 0 kg of usable material, the client still owes the full processing fee** for that 100 kg (or however the machine's `charge_basis` measures it — weight / bags / hours).

**Why:** It's a service business. The plant charged its time, fuel, and machine wear on the input. The supplier's bad luck on yield is the supplier's problem.

**How to apply:**
- `processing_records` schema has no `output_weight` field.
- `processing_machine_usage.measurement` is the input value in the machine's basis units (kg / bags / hours).
- Total processing fee for a visit = `SUM(line_cost)` across the machines used; computed on read.
- Receiving role records the output weight separately on `analysis_records.weight`, which is what `pricing.purchase_amount` multiplies against.
- Processing fee is owed even when the visit ends with no agreement (no purchase).

### Owner decides payment terms; Manager records them

For every visit that reaches an agreement, the **Owner** is the only person who decides how the payment will happen — immediate, deferred (pay later), installments, or deducted from the processing fee. The Owner negotiates this with the client over **WhatsApp / phone call**, entirely outside the app. The **Manager** records the agreed terms in the system (because Manager is the one at the operational pricing screen), but the authority is the Owner's. The **Accountant** then just executes — creates ledger entries that match what the Owner decided.

**Why:** Family-run business. Owner holds all financial-relationship authority and many deals are flexible/relationship-based (e.g., "pay me next month after you sell"). Manager is operational, not financial. Accountant is execution, not decision.

**How to apply:**
- Manager's pricing screen has a `payment_terms` field (immediate / deferred / installment / deducted) — fillable by Manager, but the value represents Owner's decision transcribed.
- No in-app workflow asks the Owner to "approve" payment terms separately — that handshake happens on WhatsApp. The app trusts whatever Manager records, with Owner retaining global edit rights.
- Accountant's screens (Phase 3) show the recorded terms and let them create ledger entries that match. Accountant cannot change the terms.
- Phase 2 doesn't need a dedicated "owner approves terms" button. Owner override (if the recorded terms are wrong) is a normal edit available to owner role only.

### This is not a full financial system

The `payments` ledger (Phase 3) tracks **per-visit** money flows only — processing fee in, purchase amount out, with installments / deductions. That's it.

What the app does NOT track:
- **Bulk-sale revenue (Phase 4).** When stored stock is sold to a buyer, the Owner approves the sale and `stock_movements` decrements. Whether/how the buyer pays is **Owner's domain**, not Accountant's. Bulk sales do **not** create rows in `payments`.
- **General business cash flow.** Because it's a family business, the Owner may draw business funds for personal/family purposes. The app makes no attempt to reconcile total-in vs total-out.
- **Anything the Owner handles by phone/WhatsApp/cash without telling the app.**

**Why:** The owner already runs the money side his way; the app's job is to give per-supplier transparency (what did we agree to pay this client, how much have we paid, what's left) and per-site operational visibility — not to be his books.

**How to apply:**
- Accountant's screens read/write the `payments` table scoped to `direction in ('processing_fee_in', 'purchase_amount_out')` and tied to a `visit_id`. No "petty cash", "expenses", "bank reconciliation" features.
- Bulk-sale revenue tracking, if needed at all, lives on `bulk_sales` (e.g., a `received_amount` field) and is editable only by Owner.
- Owner dashboard (Phase 5) shows per-visit balances and stock movements, not a P&L.
- Reject feature requests that drift toward bookkeeping (vendor payments, payroll, tax reports, etc.) — out of scope by design.

### Suppliers master list grows organically

There **is** a `suppliers` master table. At visit creation (currently the gate intake form; after Phase 7 this moves to the processing intake form), the user searches the existing list first (by phone or name) — if the supplier is already registered, the visit links to that `supplier_id`. If not found, the user fills in the details inline and a new `suppliers` row is created on visit save. The list grows; there is no separate "register supplier" workflow.

**Suppliers are global across all 3 sites** — no `site_id` on the `suppliers` table. A supplier registered at Site A is searchable from Site B's gate. Per-site filtering of visits happens on `visits.site_id`, not on the suppliers table.

**Why:** Same person showing up across many visits should produce one DB record, not N inline copies. Enables filtering the DB to a single supplier's full history (visits, processing fees, purchases, balances) — useful for the Owner when a regular has long-running deals or installment payments spanning visits.

**How to apply:**
- `suppliers` schema: `id`, `name`, `phone`, `notes`, `created_at`, `created_by`, `updated_at`. **No `site_id`.** No vehicle FK — plate is a per-visit snapshot, not a key.
- `visits` schema: `supplier_id` FK (NOT NULL) + `site_id` on the visit + snapshot `vehicle_plate` on the visit row (vehicle can vary visit-to-visit; supplier identity does not).
- Gate intake UI: search field hits the global table; matching row pre-fills; no match → inline "create new supplier" form.
- RLS on `suppliers`: any authenticated user can SELECT/INSERT (it's a global lookup); UPDATE/DELETE owner-only. Lane isolation is enforced on `visits`, not on `suppliers`.

### Edit policy: each role edits its own record until the visit closes

Each role can edit its own record on a visit at any time, as long as the visit is still **open**. A visit is **closed** (no more edits) when it reaches a terminal state — `exited` (no-agreement path) or `stocked` (full-pipeline path, Phase 4). Closed visits are read-only for everyone except the Owner. The Owner can edit any record on any visit, open or closed.

**Why:** Small family-run business with manual data entry — typos and missed fields are normal. Forcing a "submit and lock" flow would push every correction through the Owner over WhatsApp, which doesn't scale. Letting each role self-correct is faster and matches how the people actually work.

**How to apply:**
- Editability is by **role × site** match plus visit-state check, not by `created_by` identity — any Receiving user at Site A can fix any Receiving record at Site A (small teams; the original author may be off-shift).
- Visit state `exited` or `stocked` → all records read-only for non-owners. Enforced in RLS: UPDATE policies on `processing_records`, `analysis_records`, `pricing` include `public.visit_is_open(visit_id)`.
- Owner UPDATE policy: unconditional (any record, any state). Owner edits to a closed visit still write to `transaction_events` so the audit trail captures who changed what after closure.
- **Derived values auto-recompute on edit:** if Manager edits `unit_price` or Receiving edits `weight`, `pricing.purchase_amount` is recomputed at write time via trigger. Same applies to processing fee if a machine measurement is edited.
- Every UPDATE to a stage record appends a `transaction_events` row of type `record_edited` capturing actor, field-level diff (`{old: ..., new: ...}`), and timestamp.

### Owner approves bulk sales (Phase 4)

For bulk sales of stockpiled material out to buyers, **only the Owner can approve**. The Inventory Manager creates a bulk sale record with `approval_status='pending'`; the row sits in the Owner's queue; on owner approval, a `stock_movements` row of direction `out` is written and stock decrements. Without approval, no stock decrements.

The Owner is also the only role allowed to record "adjustment" stock movements (waste, theft write-offs).

### No in-app communication

WhatsApp handles every human comm: temp passwords, payment-term negotiations, bulk-sale approvals, dispute resolution. The app makes no attempt to message users; no in-app inbox, no notifications, no chat. Be skeptical of any feature request that adds messaging — it's almost certainly out of scope.

---

## Glossary

Plain-English definitions for terms used throughout this document. If you see a word you don't recognize, check here first.

**Branch (git):** A parallel line of work in the codebase. `phase-2-visit-workflow` is a branch; so is `main`. You "switch to" a branch with `git checkout`. Your changes live on whatever branch you're currently on until you merge them somewhere else.

**Brainstorming (Superpowers skill):** The first step in any phase. The Claude agent asks the owner/manager questions about what to build before writing code. Always do this before implementation.

**CHECK constraint (Postgres):** A rule the database enforces on every row. Example: `CHECK (amount > 0)` means the database refuses to save a row whose `amount` is zero or negative. Faster and safer than checking in app code.

**Cherry-pick (git):** Copy a single commit from one branch to another. We used this to put BUILD_PHASES.md on multiple branches.

**Claude Code agent / subagent:** Claude running in agent mode — it can read files, write code, run tests, and commit. The handoff plan dispatches a fresh subagent per task so each one has clean context.

**Commit (git):** A snapshot of your changes with a message describing what you did. Created with `git commit`. Lives on whatever branch you're on.

**Cron / cron job:** A scheduled task that runs automatically (e.g., "every night at 2 a.m."). We don't use any yet; Phase 5 might add a materialized-view refresh cron.

**CRUD:** Create / Read / Update / Delete. The four operations on database rows. An "Owner CRUD page" lets the Owner do all four.

**Enum:** A fixed list of allowed values. Example: `entry_path` can only be `'unprocessed'` or `'pre_processed'`. Enforced by a `CHECK` constraint.

**FK (foreign key):** A column whose value must match an existing ID in another table. Example: `visits.supplier_id` is a FK pointing at `suppliers.id`.

**Force-push (git):** `git push --force`. Overwrites the remote branch with your local version, even if the remote has different commits. Dangerous if other people have pulled the branch. We use `--force-with-lease` instead, which refuses to overwrite if the remote has changed unexpectedly.

**JSONB (Postgres):** A column type that stores structured JSON data (like `{"Sn": 58.2, "Fe": 12.1}`) and lets you query inside it. Used for flexible fields like XRF readings and audit-log payloads.

**Merge (git):** Combine changes from one branch into another. `git merge phase-2-visit-workflow` while on `main` brings Phase 2's commits into main.

**Middleware (Next.js):** Code that runs before every page request. Our middleware checks if the user is logged in, what role they have, and redirects them away from pages they shouldn't see.

**Migration (database):** A SQL file that changes the database schema (adds tables, columns, constraints, etc.). Numbered sequentially. Once merged to main, **never edit a migration** — write a new one to fix anything.

**Next.js (App Router):** The web framework we use. Pages live in `src/app/`. The "App Router" is the modern version (vs. the older "Pages Router").

**PR (Pull Request):** A web page on GitHub for proposing a merge. Shows the diff, lets reviewers comment, and has an "Approve & Merge" button.

**Postgres:** The database engine, accessed via Supabase. SQL is the language used to query it.

**Rebase (git):** Re-anchor a branch to a different starting point. Used to keep branches up to date without merge commits. Rewrites history; needs force-push.

**Repository / repo:** The whole project's code and history, stored in git. Cloned via `git clone`.

**RLS (Row-Level Security):** Postgres policies that decide who can read or write each row. Example: a Gate user can only read visits from their own site. Enforced by the database, not by app code.

**Server action (Next.js):** A function marked `"use server"` that runs on the server when a form is submitted. Replaces traditional REST API routes for most form work.

**Service-role key (Supabase):** A secret key that bypasses all RLS rules. Used only on the server for owner-only operations like creating new user accounts. Must never reach the browser.

**Squash merge / squash-merge:** A PR-merge style that condenses every commit on the branch into a single commit on the target branch. Cleaner history; loses individual commit messages.

**Supabase:** A service that gives us Postgres + Authentication + File Storage with one set of keys. Runs locally for development (`npx supabase start`) and in the cloud for production.

**Tailwind v4:** A CSS framework. Lets you style things by adding classes like `px-4 py-2 bg-black` directly to HTML, instead of writing separate CSS files.

**TDD (Test-Driven Development):** Write the failing test first, then write the minimum code to make it pass, then commit. Every Phase 2 task uses this pattern.

**Tag (git):** A label pinned to a specific commit. Used for releases or milestones. We tag `phase-N-merged` on main after each merge.

**Trigger (Postgres):** A function the database runs automatically when something happens (e.g., "when a row is inserted into `processing_records`, also update `visits.state`"). Used for our state-machine and audit log.

**TypeScript:** JavaScript with type annotations. Catches type errors at build time. All our code is TypeScript.

**Vercel:** The hosting service where the production app runs. We push to GitHub → Vercel auto-deploys.

**Vitest:** The test runner. `npm run test` invokes it. Runs every `.test.ts` file in `tests/`.

**Worktree (git):** A separate working copy of the repo, lets you work on multiple branches simultaneously without switching. We don't currently use these; the Claude agent might, optionally.

