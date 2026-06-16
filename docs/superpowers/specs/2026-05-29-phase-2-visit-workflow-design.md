# Phase 2 — Inbound Visit Workflow Design Spec

**Date:** 2026-05-29
**Company:** MAGNETIC JOEZION NIG. LTD
**Phase:** 2 of 6
**Status:** Approved design, pending implementation plan
**Builds on:** Phase 1 foundation (`sites`, `profiles`, `setup_codes`, auth, owner provisioning)

> This spec revises portions of `2026-05-27-mining-inventory-system-design.md`. Where they differ, this document wins. Specifically: `suppliers` is global (not site-scoped); `processing_records` carry no `output_weight`; `pricing.payment_terms` is recorded by Manager (transcribed from Owner) and only acted on in Phase 3; the legacy `project.md` remains stale and is referenced only for the XRF analysis field list.

---

## 1. Goal

Build the inbound visit workflow end-to-end from gate intake through Manager pricing, plus the no-agreement gate-exit path. Phase 2 finishes when a visit can reach either `in_accounting` (waiting for Phase 3) or `exited` (terminal, Owner-authorized).

**Out of scope for this phase:** Accountant screens / payments ledger (Phase 3), inventory intake / stock movements (Phase 4), Owner dashboard (Phase 5), branded PDF export (Phase 6), bulk sales (Phase 4).

---

## 2. Phase 2 Surface Area

| New tables | New screens | New server actions |
|---|---|---|
| `suppliers`, `material_types`, `machines`, `visits`, `processing_records`, `processing_machine_usage`, `analysis_records`, `pricing`, `gate_exit_authorizations`, `transaction_events` | `/gate` (queue + intake form), `/processing` (queue), `/receiving` (queue), `/manager` (queue), `/owner` extensions, shared `/visits/[id]` | gate intake submit, processing submit, analysis submit, pricing submit, owner-authorize-exit, gate-release, material-type CRUD, machine CRUD |

---

## 3. Data Model

All new tables (added on top of Phase 1's `sites`, `profiles`, `setup_codes`).

### 3.1 `suppliers` — global lookup

```sql
CREATE TABLE suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_phone_idx ON suppliers (phone);
CREATE INDEX suppliers_name_idx  ON suppliers USING gin (name gin_trgm_ops);
```

- **No `site_id`** — suppliers are global across all 3 sites. Per-site filtering happens on `visits`, not here.
- Gate searches by phone first, name fallback. No match → inline "create new" within the gate intake form.
- Owner-only UPDATE/DELETE; any authenticated user can SELECT/INSERT.

### 3.2 `material_types` — owner-managed enum

```sql
CREATE TABLE material_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id)
);
```

- Soft delete via `active=false` so closed visits still reference valid rows.
- Seed migration populates the company's actual material list (Owner confirms exact names before implementation).
- Owner-only writes; everyone reads.

### 3.3 `machines` — per-site machine registry

```sql
CREATE TABLE machines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id),
  name          text NOT NULL,
  charge_basis  text NOT NULL CHECK (charge_basis IN ('weight','bag','hour')),
  rate          numeric(12,2) NOT NULL CHECK (rate >= 0),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id),
  UNIQUE (site_id, name)
);
```

- Site-scoped on read (non-owner). Owner-only writes.
- `rate` is the current rate; historic rates are preserved on processing records via snapshot (§3.6).

### 3.4 `visits` — central object

```sql
CREATE TABLE visits (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                     uuid NOT NULL REFERENCES sites(id),
  supplier_id                 uuid NOT NULL REFERENCES suppliers(id),
  vehicle_plate               text,
  declared_material_type_id   uuid NOT NULL REFERENCES material_types(id),
  entry_path                  text NOT NULL CHECK (entry_path IN ('unprocessed','pre_processed')),
  state                       text NOT NULL CHECK (state IN (
                                 'at_gate_in','in_processing','in_receiving','pricing',
                                 'in_accounting','awaiting_gate_exit','exited',
                                 'awaiting_stock_intake','stocked')),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL REFERENCES profiles(id),
  closed_at                   timestamptz   -- set when state hits 'exited' or 'stocked'
);
CREATE INDEX visits_site_state_idx ON visits (site_id, state);
CREATE INDEX visits_supplier_idx   ON visits (supplier_id);
```

- `vehicle_plate` is a snapshot — vehicles can vary per visit; supplier identity does not.
- `declared_material_type_id` is the gate guard's pick at intake; receiving may correct (analysis record carries authoritative grade, but material_type is still the gate's intent).

### 3.5 `processing_records` (+ child usage rows)

```sql
CREATE TABLE processing_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      uuid NOT NULL UNIQUE REFERENCES visits(id),
  recorded_by   uuid NOT NULL REFERENCES profiles(id),
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processing_machine_usage (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_record_id   uuid NOT NULL REFERENCES processing_records(id) ON DELETE CASCADE,
  machine_id             uuid NOT NULL REFERENCES machines(id),
  measurement            numeric(12,3) NOT NULL CHECK (measurement >= 0),
  rate_snapshot          numeric(12,2) NOT NULL CHECK (rate_snapshot >= 0),
  line_cost              numeric(14,2) GENERATED ALWAYS AS (measurement * rate_snapshot) STORED
);
```

- One processing record per visit; multi-machine via the child table.
- `measurement` is the **input** value in the machine's `charge_basis` units (kg / bags / hours). **No output_weight** — receiving will weigh whatever's left.
- `rate_snapshot` copies `machines.rate` at record time so later rate changes don't rewrite history.
- Total processing fee for a visit = `SUM(line_cost) FROM processing_machine_usage WHERE processing_record_id = X`. Computed on read, not stored.

### 3.6 `analysis_records`

```sql
CREATE TABLE analysis_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id          uuid NOT NULL UNIQUE REFERENCES visits(id),
  weight            numeric(12,3) NOT NULL CHECK (weight >= 0),
  sample_id         text,
  xrf_result        jsonb,     -- { "Sn": 58.2, "Fe": 12.1, ... } — flexible
  purity            numeric(5,2) CHECK (purity >= 0 AND purity <= 100),
  grade             text,
  qc_observations   text,
  analyzed_at       timestamptz,
  recorded_by       uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

- `weight` is the post-processing (or as-arrived for `pre_processed` path) weight that pricing multiplies against.
- `xrf_result` JSONB to accept any combination of element readings without schema changes.
- Pricing is blocked until this row exists (state-machine invariant, §4.2).

### 3.7 `pricing`

```sql
CREATE TABLE pricing (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id            uuid NOT NULL UNIQUE REFERENCES visits(id),
  unit_price          numeric(12,2) CHECK (unit_price >= 0),
  purchase_amount     numeric(14,2),  -- maintained by t_pricing_purchase_amount (§6)
  agreement_status    text NOT NULL DEFAULT 'pending'
                          CHECK (agreement_status IN ('pending','agreed','not_agreed')),
  payment_terms       text CHECK (payment_terms IN ('immediate','deferred','installment','deducted')),
  priced_by           uuid REFERENCES profiles(id),
  overridden_by       uuid REFERENCES profiles(id),  -- owner who last edited
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreed_requires_price     CHECK (agreement_status <> 'agreed' OR unit_price IS NOT NULL),
  CONSTRAINT agreed_requires_terms     CHECK (agreement_status <> 'agreed' OR payment_terms IS NOT NULL)
);
```

- `purchase_amount` is maintained by a BEFORE INSERT/UPDATE trigger (`t_pricing_purchase_amount`, §6.1) that recomputes it as `unit_price × analysis_records.weight`. A Postgres `GENERATED ALWAYS AS … STORED` column cannot reference another table, so we use a trigger. A second trigger on `analysis_records` UPDATE of `weight` recomputes the corresponding `pricing.purchase_amount`.
- `payment_terms` is Manager's transcription of the Owner's WhatsApp decision; Phase 3 acts on it.
- `overridden_by` flags Owner edits for the audit timeline.

### 3.8 `gate_exit_authorizations`

```sql
CREATE TABLE gate_exit_authorizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        uuid NOT NULL UNIQUE REFERENCES visits(id),
  authorized_by   uuid NOT NULL REFERENCES profiles(id),
  authorized_at   timestamptz NOT NULL DEFAULT now(),
  note            text
);
```

- Owner-only INSERT. Once a row exists for a visit, gate can transition `awaiting_gate_exit` → `exited`.
- No UPDATE — re-authorization is a new row (rare; not built into Phase 2 UI but schema permits it).

### 3.9 `transaction_events` — append-only audit log

```sql
CREATE TABLE transaction_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    uuid NOT NULL REFERENCES visits(id),
  event_type  text NOT NULL CHECK (event_type IN (
                'visit_created','state_changed','record_created','record_edited',
                'gate_exit_authorized','gate_released','owner_override')),
  actor_id    uuid REFERENCES profiles(id),   -- nullable for system events; in practice always set
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_events_visit_idx ON transaction_events (visit_id, created_at);
```

Payload shape per event type:

| event_type | payload |
|---|---|
| `visit_created` | `{ entry_path, supplier_id, declared_material_type_id, vehicle_plate, site_id }` |
| `state_changed` | `{ from, to, override?: boolean }` |
| `record_created` | `{ table, record_id, fields }` |
| `record_edited` | `{ table, record_id, diff: { col: { old, new } } }` |
| `gate_exit_authorized` | `{ authorized_by, note }` |
| `gate_released` | `{ released_by, authorization_id }` |
| `owner_override` | `{ table, record_id, reason? }` |

Client direct INSERT is denied — events are written only by triggers (§5).

---

## 4. State Machine

### 4.1 States and transitions

```
                          ┌─ entry_path = unprocessed ────────┐
at_gate_in (Gate intake) ─┤                                    │
                          └─ entry_path = pre_processed ──────┐│
                                                               ▼▼
                                        in_processing ───▶ in_receiving ───▶ pricing
                                                                                │
                              ┌─────────────────────────────────────────────────┴────┐
                       agreement_status='agreed'                   agreement_status='not_agreed'
                              ▼                                                        ▼
                       in_accounting                                          awaiting_gate_exit
                       (Phase 3)                                                       │
                              ▼                                              Owner authorizes (button)
                       awaiting_stock_intake                                            │
                       (Phase 4)                                              Gate clicks "Release"
                              ▼                                                        ▼
                       stocked (terminal)                                       exited (terminal)
```

`at_gate_in` is transient — the gate intake form's submission both inserts the visit and immediately transitions state to `in_processing` or `in_receiving` in the same transaction. There is no "waiting at gate" queue; if such a queue is ever wanted operationally, it's a future concern.

### 4.2 Allowed transitions and triggers

| From | To | Trigger | Actor role |
|---|---|---|---|
| (insert) | `at_gate_in` | Visit row inserted with `state='at_gate_in'` by gate intake server action | Gate |
| `at_gate_in` | `in_processing` | Server action UPDATEs state in the same transaction if `entry_path='unprocessed'` | Gate (server action) |
| `at_gate_in` | `in_receiving` | Server action UPDATEs state in the same transaction if `entry_path='pre_processed'` | Gate (server action) |
| `in_processing` | `in_receiving` | `processing_records` INSERT → trigger `t_processing_records_audit` updates `visits.state` (SECURITY DEFINER) | Processing |
| `in_receiving` | `pricing` | `analysis_records` INSERT → trigger `t_analysis_records_audit` updates `visits.state` (SECURITY DEFINER) | Receiving |
| `pricing` | `in_accounting` | `pricing` INSERT or UPDATE that lands `agreement_status='agreed'` (with `unit_price` and `payment_terms` set) → trigger `t_pricing_audit` updates `visits.state` (SECURITY DEFINER) | Manager |
| `pricing` | `awaiting_gate_exit` | `pricing` INSERT or UPDATE that lands `agreement_status='not_agreed'` → same trigger | Manager |
| `awaiting_gate_exit` | `exited` | Gate "Release" server action UPDATEs `visits.state` — state-machine trigger checks `gate_exit_authorizations` row exists | Gate |
| any | (any earlier state) | Owner UPDATEs `visits.state` directly — state-machine trigger detects `is_owner()` AND backward jump, writes `owner_override` event | Owner |

### 4.3 Invariants (enforced in DB)

1. State transitions follow the table above. A BEFORE UPDATE trigger on `visits` validates `(OLD.state, NEW.state)` against the allowed set; rejects with a clear error otherwise (except for Owner, who can move backward — checked via `is_owner()`).
2. `in_receiving` → `pricing` requires `EXISTS (SELECT 1 FROM analysis_records WHERE visit_id = NEW.id)`.
3. `pricing` → `in_accounting` requires `pricing.agreement_status='agreed' AND pricing.unit_price IS NOT NULL AND pricing.payment_terms IS NOT NULL`. The `pricing` table's CHECK constraints already cover the last two; the trigger validates `agreement_status='agreed'`.
4. `awaiting_gate_exit` → `exited` requires `EXISTS (SELECT 1 FROM gate_exit_authorizations WHERE visit_id = NEW.id)`.
5. On any transition into `exited` or `stocked`, the trigger sets `closed_at = now()`.
6. Once `state IN ('exited','stocked')`, child-record UPDATE policies block non-owner writes via `visit_is_open()` (§5.3).

---

## 5. RLS Policies

Phase 1 helpers reused: `current_role()`, `current_site()`, `is_owner()`. New helper:

```sql
CREATE FUNCTION public.visit_is_open(_visit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT state NOT IN ('exited','stocked') FROM visits WHERE id = _visit_id;
$$;
```

### 5.1 Policy summary

| Table | Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `suppliers` | any auth | ✓ | ✓ | — | — |
| `suppliers` | owner | ✓ | ✓ | ✓ | ✓ |
| `material_types` | any auth | ✓ | — | — | — |
| `material_types` | owner | ✓ | ✓ | ✓ | ✓ |
| `machines` | non-owner | own site | — | — | — |
| `machines` | owner | ✓ | ✓ | ✓ | ✓ |
| `visits` | gate | own site | own site | state column only, allowed transitions | — |
| `visits` | processing/receiving/manager | own site | — | state column only, allowed transitions | — |
| `visits` | owner | ✓ | ✓ | ✓ | — |
| `processing_records` | processing | own site (via visit FK) | open visit in `in_processing` | open visit | — |
| `processing_records` | other non-owner | own site | — | — | — |
| `processing_records` | owner | ✓ | ✓ | ✓ | ✓ |
| `processing_machine_usage` | inherits parent | inherits parent | inherits parent | inherits parent | inherits parent |
| `analysis_records` | receiving | own site | open visit in `in_receiving` | open visit | — |
| `analysis_records` | other non-owner | own site | — | — | — |
| `analysis_records` | owner | ✓ | ✓ | ✓ | ✓ |
| `pricing` | manager | own site | open visit in `pricing` | open visit | — |
| `pricing` | other non-owner | own site | — | — | — |
| `pricing` | owner | ✓ | ✓ | ✓ | ✓ |
| `gate_exit_authorizations` | non-owner | own site | — | — | — |
| `gate_exit_authorizations` | owner | ✓ | ✓ | — | — |
| `transaction_events` | any auth | own site (via visit FK; owner all) | — (triggers only) | — | — |

### 5.2 Column-level UPDATE restrictions on `visits`

Same pattern as Phase 1's `must_change_password` fix (column REVOKE alone doesn't work — table REVOKE + column GRANT does).

| Role | Columns it may UPDATE directly |
|---|---|
| gate | `supplier_id`, `vehicle_plate`, `declared_material_type_id`, `entry_path` (edit-intake action); `state` (release action moves `awaiting_gate_exit` → `exited`) |
| processing, receiving, manager, accounting, inventory | (no direct column UPDATE on `visits`) |
| owner | (table-level UPDATE retained) |

State transitions caused by inserts into child tables (e.g., processing insert → visits state change) are performed by **`SECURITY DEFINER` triggers** running as the schema owner, so the trigger can update `visits.state` even when the actor's role has no direct UPDATE grant on that column. The state-machine trigger itself enforces that only legal transitions occur, so SECURITY DEFINER is not a security hole.

### 5.3 "Visit is open" gate

UPDATE policies on `processing_records`, `analysis_records`, `pricing` include `visit_is_open(visit_id)` so closed visits become read-only for non-owners. Owner UPDATE policies omit this check.

### 5.4 Privileged operations

The following run in Next.js server actions / route handlers with the service-role key (no direct client RLS path):

- Gate intake (creates supplier-if-new + visit + transitions state) — uses anon client (gate role has the necessary INSERT policies) but wrapped in a server action for transaction atomicity.
- Owner-authorize-exit — uses anon client (owner has INSERT on `gate_exit_authorizations`).
- Material-type CRUD, Machine CRUD — owner anon client.
- Gate "Release" action — anon client (gate has UPDATE on `visits.state`).

Service-role key usage is reserved for things RLS cannot express (employee provisioning from Phase 1). Phase 2 doesn't add new service-role-key paths.

---

## 6. Triggers

### 6.1 Trigger inventory

All triggers are `SECURITY DEFINER` running as the schema owner; this lets them write `transaction_events` rows (denied to all client roles by RLS) and update `visits.state` (denied by column-level GRANT to non-gate non-owner roles).

| Trigger | On | When | What it does |
|---|---|---|---|
| `t_visits_state_machine` | `visits` | BEFORE UPDATE OF state | Validates transition against allowed set; checks invariants (§4.3); sets `closed_at` on terminal entry |
| `t_visits_audit` | `visits` | AFTER INSERT, AFTER UPDATE | Writes `visit_created` (insert) or `state_changed` (update of state) to `transaction_events`. If `is_owner()` and the transition is backward, also writes `owner_override`. |
| `t_processing_records_audit` | `processing_records` | AFTER INSERT, AFTER UPDATE | Writes `record_created` / `record_edited`. On INSERT, updates parent `visits.state` `in_processing` → `in_receiving`. |
| `t_analysis_records_audit` | `analysis_records` | AFTER INSERT, AFTER UPDATE | Writes `record_created` / `record_edited`. On INSERT, updates parent `visits.state` `in_receiving` → `pricing`. On UPDATE OF `weight`, triggers `pricing.purchase_amount` recompute (calls `t_pricing_purchase_amount` indirectly via UPDATE on the pricing row). |
| `t_pricing_audit` | `pricing` | AFTER INSERT, AFTER UPDATE | Writes `record_created` / `record_edited`. If the resulting `agreement_status` is `agreed`, updates parent `visits.state` → `in_accounting`. If `not_agreed`, → `awaiting_gate_exit`. Re-entering `pending` is a no-op for state. |
| `t_pricing_purchase_amount` | `pricing` | BEFORE INSERT, BEFORE UPDATE | Sets `NEW.purchase_amount = NEW.unit_price * analysis_records.weight` (or NULL if either is NULL). |
| `t_gate_exit_authorized` | `gate_exit_authorizations` | AFTER INSERT | Writes `gate_exit_authorized`. |

The "backward state jump → `owner_override`" detection lives in `t_visits_audit` (not a separate trigger) so the order of events for a backward jump is `state_changed` then `owner_override` in the same transaction.

### 6.2 Diff helper

```sql
CREATE FUNCTION public.jsonb_diff_changed(old jsonb, new jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('old', old->k, 'new', new->k)), '{}'::jsonb)
  FROM jsonb_object_keys(new) k
  WHERE old->k IS DISTINCT FROM new->k;
$$;
```

Used by the four `_audit` triggers to compute `record_edited` payloads from `to_jsonb(OLD)` and `to_jsonb(NEW)`.

### 6.3 Direct insert into `transaction_events`

Denied by RLS. Only the triggers above (which run in the table owner's privilege via `SECURITY DEFINER`) can write rows.

---

## 7. Role Screens (UI)

All screens are Next.js App Router pages under `src/app/`. The shared visit detail page lives at `/visits/[id]` and is reused by all roles.

### 7.1 Per-role home

| Route | Owner | Layout |
|---|---|---|
| `/gate` | gate role | Header with "+ New visit intake" button; section "Awaiting release" (visits in `awaiting_gate_exit` at this site); section "My recent intakes" (last 20 visits this user created — for self-correction) |
| `/processing` | processing role | Queue table: visits in `in_processing` at this site. Columns: created time, supplier name, declared material, vehicle plate. Click row → `/visits/[id]` |
| `/receiving` | receiving role | Queue: visits in `in_receiving` at this site. Columns same + entry_path (so the receiver knows whether processing was done) |
| `/manager` | manager role | Queue: visits in `pricing` at this site. Columns same + analysis grade + analysis weight (triage info). Click → `/visits/[id]` |
| `/owner` | owner role | Cross-site action board: visits in `awaiting_gate_exit` across all 3 sites (most urgent). Quick links to `/owner/material-types`, `/owner/machines`, `/owner/employees` (Phase 1), `/owner/visits` (cross-site browser). Phase 5 expands this to the full dashboard. |

### 7.2 Gate intake form

Single page form composed of two sections: supplier (search-first, create-if-new) and visit. Submit creates the supplier (if needed) and the visit in one server action.

```
┌─ Supplier ──────────────────────────────────┐
│ Phone or name [..............] [Search]    │
│                                             │
│ Match found:                                │
│   ◯ Musa Abubakar  (07012345678)            │
│   ◯ Musa A.        (07099887766)            │
│   ◯ Add new supplier                        │
│                                             │
│ [if "Add new" selected:]                    │
│   Name  [...............]                   │
│   Phone [...............]                   │
│   Notes [...............]                   │
└─────────────────────────────────────────────┘
┌─ This visit ────────────────────────────────┐
│ Vehicle plate            [...............]  │
│ Declared material type   [▼ from enum ...]  │
│ Entry path:    ◯ Unprocessed  ◯ Pre-processed │
└─────────────────────────────────────────────┘
                                    [Save intake]
```

Form validation client-side AND in the server action (server is authoritative).

### 7.3 Shared visit detail page (`/visits/[id]`)

Vertical timeline of stage cards. Each card renders if its data exists OR if the current viewer's role × current visit state would make it the actor for that stage. Action buttons are gated by `(viewer_role × visit_state × visit_open)`.

```
┌────────────────────────────────────────────────────────┐
│ Visit V-2026-05-29-0012        State: pricing  [badge]│
│ Site: Osun  •  Supplier: Musa Abubakar (070...)       │
│ Vehicle: ABC-123-XY  •  Declared: Tin Ore             │
│ Path: Unprocessed  •  Created: 2026-05-29 09:14 (gate)│
└────────────────────────────────────────────────────────┘

┌─ 1. Gate intake ────────────────── ✓ done ──────────┐
│ ...details from visits row...                       │
│ [Edit] (gate role, visit open) | (owner)            │
└─────────────────────────────────────────────────────┘

┌─ 2. Processing ────────────────── ✓ done ──────────┐  (skipped if pre_processed)
│ Crusher #1: 320 kg @ ₦15/kg = ₦4,800                │
│ Total fee: ₦4,800                                   │
│ [Edit] (processing role, visit open) | (owner)      │
└─────────────────────────────────────────────────────┘

┌─ 3. Analysis ──────────────────── ✓ done ──────────┐
│ Weight: 305 kg • Grade: B+ • Purity: 58%            │
│ XRF: [View raw JSON]                                │
│ [Edit] (receiving role, visit open) | (owner)       │
└─────────────────────────────────────────────────────┘

┌─ 4. Pricing ─────────────────── pending ────────────┐
│ [Set price form: unit_price, agreement, terms]      │
│ [Submit] (manager role, state=pricing) | (owner)    │
└─────────────────────────────────────────────────────┘

┌─ 5. Exit authorization ── (only if awaiting_gate_exit) ─┐
│ [Authorize exit] (owner only, no auth row yet)          │
│ — OR —                                                  │
│ Authorized by: Owner-OO at 14:22 — "Material returned"  │
│ [Release] (gate role, auth row exists)                  │
└─────────────────────────────────────────────────────────┘

┌─ Audit trail ────── (collapsible) ────────────────┐
│ • 09:14 visit_created by gate-osun-1               │
│ • 09:14 state_changed at_gate_in → in_processing  │
│ • 10:42 record_created processing                  │
│ • 10:42 state_changed in_processing → in_receiving │
│ • ...                                              │
└────────────────────────────────────────────────────┘
```

RLS scope: non-owner sees this page only for visits at their own site; navigating to a foreign-site visit URL returns 404 (RLS row not found).

### 7.4 Owner-only configuration screens

- **`/owner/material-types`** — list with active/inactive toggle and "+ Add" form. Edit name / soft-delete only; no hard delete.
- **`/owner/machines`** — list grouped by site; "+ Add" form (name, site, charge_basis, rate, active). Edit any field; soft-delete via `active=false`. Historic rates preserved on existing `processing_machine_usage.rate_snapshot`.
- **`/owner/visits`** — cross-site list with filters (site, state, date range, supplier search). Each row links to `/visits/[id]`.

### 7.5 Action buttons matrix

| Card | Visible to | Enabled when |
|---|---|---|
| Edit gate intake | gate role at this site, owner | visit open |
| Edit processing | processing role at this site, owner | visit open AND processing record exists |
| Submit processing | processing role at this site, owner | visit state = `in_processing` AND no processing record yet |
| Edit analysis | receiving role at this site, owner | visit open AND analysis record exists |
| Submit analysis | receiving role at this site, owner | visit state = `in_receiving` AND no analysis record yet |
| Edit pricing | manager role at this site, owner | visit open AND pricing row exists |
| Set / submit pricing | manager role at this site, owner | visit state = `pricing` |
| Authorize exit | owner only | visit state = `awaiting_gate_exit` AND no authorization yet |
| Release | gate role at this site, owner | visit state = `awaiting_gate_exit` AND authorization exists |

---

## 8. Server Actions

All under `src/app/(role)/.../actions.ts`. Each:

1. Verifies the current user's role explicitly (defense-in-depth with RLS).
2. Performs the DB write through the user's session (anon key + JWT) so RLS applies.
3. Returns `{ success, redirectTo }` or `{ error }` for `useActionState`.

| Action | Path | Inputs | Effect |
|---|---|---|---|
| `submitGateIntake` | `src/app/gate/actions.ts` | supplier (existing or new), visit fields | Insert supplier (if new), insert visit (state = `at_gate_in`), update state to `in_processing`/`in_receiving` based on path. Triggers write events. |
| `updateGateIntake` | `src/app/gate/actions.ts` | visit id, fields | UPDATE visits row; trigger logs `record_edited` |
| `submitProcessing` | `src/app/processing/actions.ts` | visit id, machine usages [] | Insert processing_record + N processing_machine_usage rows; trigger transitions visit + writes events |
| `updateProcessing` | `src/app/processing/actions.ts` | record id, usages | UPDATE record / replace usage rows |
| `submitAnalysis` | `src/app/receiving/actions.ts` | visit id, weight, xrf, grade, etc. | Insert analysis_record; trigger transitions visit |
| `updateAnalysis` | `src/app/receiving/actions.ts` | record id, fields | UPDATE |
| `submitPricing` | `src/app/manager/actions.ts` | visit id, unit_price, agreement, payment_terms | INSERT or UPSERT pricing row; trigger transitions visit |
| `updatePricing` | `src/app/manager/actions.ts` | record id, fields | UPDATE |
| `authorizeExit` | `src/app/owner/actions.ts` | visit id, note? | INSERT gate_exit_authorizations |
| `releaseVisit` | `src/app/gate/actions.ts` | visit id | UPDATE visits.state to `exited` (trigger checks authorization exists) |
| `crudMaterialType` | `src/app/owner/material-types/actions.ts` | various | Owner-only |
| `crudMachine` | `src/app/owner/machines/actions.ts` | various | Owner-only |

---

## 9. Migrations

Sequenced after Phase 1's 0001–0005:

- `0006_material_types.sql` — table, RLS, seed (Owner confirms list before applying)
- `0007_suppliers.sql` — table + RLS (global) + trigram extension if needed for name search
- `0008_machines.sql` — table + RLS
- `0009_visits.sql` — table + indexes + `visit_is_open` helper + state-machine trigger + visit_created/state_changed audit trigger
- `0010_processing.sql` — `processing_records` + `processing_machine_usage` + audit trigger + state-transition trigger on insert
- `0011_analysis.sql` — `analysis_records` + audit trigger + state-transition trigger on insert
- `0012_pricing.sql` — `pricing` table + generated column / fallback trigger + audit trigger + state-transition trigger on update
- `0013_gate_exit.sql` — `gate_exit_authorizations` + audit trigger
- `0014_transaction_events.sql` — table + RLS (read-only via client) + `jsonb_diff_changed` helper

Each migration runs `npx supabase db reset` cleanly from scratch.

---

## 10. Testing Strategy

See spec §6 of the brainstorm session — copied here as the gate for Phase 2 completion:

### 10.1 RLS tests (`tests/rls/`)

`suppliers.rls.test.ts`, `material_types.rls.test.ts`, `machines.rls.test.ts`, `visits.rls.test.ts`, `processing-records.rls.test.ts`, `analysis-records.rls.test.ts`, `pricing.rls.test.ts`, `gate-exit-authorizations.rls.test.ts`, `transaction-events.rls.test.ts`.

Each file covers: own-lane permitted, cross-lane denied, cross-site denied for non-owner, owner permitted everywhere, edit-after-close denied for non-owner.

### 10.2 State-machine tests (`tests/state-machine/`)

`transitions.test.ts` — all legal transitions succeed; illegal rejected with descriptive error.
`invariants.test.ts` — pricing → in_accounting blocked without analysis; awaiting_gate_exit → exited blocked without authorization; closed_at set on terminal entry.
`owner-override.test.ts` — owner moves state backward; event row has `override=true`.

### 10.3 Integration tests (`tests/integration/`)

`happy-path-unprocessed.test.ts` — gate → processing → receiving → pricing(agreed) → in_accounting. Verifies all states, all records, all events.
`happy-path-preprocessed.test.ts` — same minus processing.
`no-agreement-exit.test.ts` — pricing rejected → awaiting_gate_exit → owner authorizes → gate releases → exited; asserts processing fee is owed (unprocessed) vs not (pre_processed).
`edit-while-open.test.ts` — each stage can edit its record; edits write `record_edited` events with correct diffs.
`edit-after-close.test.ts` — non-owner cannot edit any record on closed visit; owner can; owner edit writes event.

### 10.4 Audit log tests (`tests/audit/`)

`events-written.test.ts` — every state change / record create / record edit appends exactly one event row.
`diff-helper.test.ts` — `jsonb_diff_changed` returns only changed keys; handles nested JSONB.

### 10.5 Component tests (`tests/ui/`)

`gate-intake-form.test.tsx`, `visit-detail.test.tsx`, `manager-pricing-form.test.tsx`.

### 10.6 Acceptance gate

Phase 2 is "done" when:

1. All test suites above pass (`npm run test`)
2. `npx supabase db reset` reproduces schema + seed cleanly
3. Playwright walkthrough of happy path AND no-agreement path against `npm run dev` (manual confirmation)
4. `npm run build` passes with zero TypeScript errors

---

## 11. Open Items Deferred to Later Phases

| Item | Phase |
|---|---|
| Accountant screens, `payments` ledger, balance computations | 3 |
| Inventory Manager screens, `stock_movements`, `awaiting_stock_intake` → `stocked` transition UI | 4 |
| `bulk_sales` (Owner-approved outbound) | 4 |
| `consumables` + `consumable_movements` | 4 |
| Owner cross-site dashboard with aggregates, drill-downs, filters | 5 |
| Branded PDF export per subprocess | 6 |
| Renaming `src/middleware.ts` → `src/proxy.ts` (Next.js 16 deprecation) | infrastructure cleanup |
| Renaming `public.current_role()` → `public.get_app_role()` | infrastructure cleanup |
| Scoped (prefix-based) test cleanup | infrastructure cleanup |
| Cloud DB push to `wevkljmhucuhfqjgeqcb` | deployment milestone, after Phase 2 |

---

## 12. Conventions Reaffirmed from Phase 1

- TDD + frequent commits — write the failing test first.
- `src/lib/auth/roles.ts` is the single source of truth for the role list.
- Migrations immutable + reproducible (verify with `npx supabase db reset`).
- Service-role key behind `import "server-only"` in any module that uses it.
- No public signup, no in-app communication, WhatsApp handles human comms outside the app.
