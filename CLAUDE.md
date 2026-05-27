# CLAUDE.md — Mining Material Tracking & Inventory System

Role-based data-monitoring system for **MAGNETIC JOEZION NIG. LTD**, a family-run tin /
raw-metals processing and purchasing business with **three sites**. The owner needs full
cross-site oversight; every subprocess is exportable as a branded PDF.

## ⚠️ Source of truth

- **Authoritative design:** `docs/superpowers/specs/2026-05-27-mining-inventory-system-design.md`
- **Current plan:** `docs/superpowers/plans/2026-05-27-phase-1-foundation.md`
- **`Project.md` is STALE** — an over-scoped legacy doc. Do **not** treat its roles
  (Chief Auditor, Stock Auditor, Data Entry Personnel), backend (Node/Express,
  Mongo/Firebase), or future-modules list as real. Only its XRF analysis field list is
  reused, as a template for the analysis report.

## Stack (hard constraints)

- **Next.js (App Router) + TypeScript**, deployed on **Vercel**. TypeScript/JavaScript
  **only** — no Python, no separate hand-rolled backend.
- **Supabase** (Postgres + Auth + Storage) is the backend. Schema lives in
  `supabase/migrations/` and is applied with the Supabase CLI.
- **RLS is the security boundary.** Authorization is enforced in Postgres by
  `profiles.role` + `profiles.site_id`, not just in the UI. Every new table gets RLS
  policies *and* RLS tests.
- **Privileged ops** (owner provisioning, etc.) run in **server actions / route handlers**
  using the service-role key. Never import `lib/supabase/admin.ts` into client code
  (guarded by `server-only`).

## Roles (7) — each gets its own login + screen

`gate` · `processing` · `receiving` · `manager` · `accounting` · `inventory` · `owner`

- **Manager** = top operational/pricing authority; **Owner** overrides any manager price
  and is the only **cross-site, full-read** role.
- Receiving and analysis are **one** role/record (the receiver records the analysis).

## Core domain model

- **Visit** = one supplier bringing material; the spine of the inbound workflow. Two entry
  paths: `unprocessed` (→ plant) and `pre_processed` (→ straight to receiving). Two exits:
  agreement (→ accounting → inventory) or no agreement (→ owner signs the package out at
  the gate → `exited`).
- **Two money figures per visit:** *processing fee* (client owes company; only on the
  `unprocessed` path; owed even if no sale) and *purchase amount* (company owes client;
  only if agreement). `processing_deducted` flag + a `payments` ledger handle
  net/separate settlement and installments.
- **Machines** have a `charge_basis` of `weight`/`bag`/`hour` + a rate; processing cost is
  derived and snapshotted.
- **Analysis grade drives price** — pricing is blocked until an analysis record exists.
- **Inventory is a ledger** (`stock_movements` in/out), not a counter. Purchase intake is
  an explicit Inventory-Manager step; **bulk sales decrement stock only after Owner
  approval**.

## Auth

- **No public signup.** Owner provisions every account (name + username + role + site) and
  hands a one-time temp password over **WhatsApp**.
- **Email-free login by username**, mapped to a synthetic `<username>@magneticjoezion.local`
  email under the hood. Users are forced to change the temp password on first login
  (`profiles.must_change_password`).

## Out of scope

- **No in-app communication of any kind** — WhatsApp handles all human comms, entirely
  outside this app.

## Conventions

- **TDD + frequent commits.** Write the failing test first; commit per task.
- **Roles single source of truth:** `src/lib/auth/roles.ts` (`ROLES`, `ROLE_HOME`). Never
  hardcode the role list elsewhere.
- **Migrations are immutable + reproducible:** verify with `npx supabase db reset` before
  committing a migration.
- **Tests:** `npm run test` (Vitest). RLS/integration tests run against the local Supabase
  stack and must pass per role (own-lane allowed, cross-lane/cross-site denied, owner sees
  all).

## Common commands

```bash
npm run dev                 # Next.js dev server
npm run build               # production build / type-safety gate
npx supabase start          # local Postgres + Auth
npx supabase migration up   # apply new migrations
npx supabase db reset       # re-apply all migrations + seed (use to verify reproducibility)
npm run test                # Vitest (unit + RLS + provisioning)
```

## Work phases (each is its own plan once the prior lands)

1. **Foundation** — scaffold, schema (`sites`/`profiles`/`setup_codes`), RLS, login,
   role routing, owner provisioning. *(plan written)*
2. Inbound visit workflow + state machine + `transaction_events`.
3. Financial model (pricing + payments ledger + balances).
4. Inventory ledger + intake step + owner-approved bulk sales.
5. Owner dashboard (cross-site oversight + inventory).
6. Per-subprocess branded PDF export.