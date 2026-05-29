# Phase 2 Visit Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inbound visit workflow end-to-end from gate intake through Manager pricing, plus the Owner-authorized no-agreement gate-exit path.

**Architecture:** Postgres-enforced state machine on `visits` with `SECURITY DEFINER` triggers writing an append-only `transaction_events` audit log. RLS as the security boundary, layered by `current_role()`/`current_site()`/`is_owner()` from Phase 1. Next.js App Router screens per role (`/gate`, `/processing`, `/receiving`, `/manager`, `/owner`) plus a shared `/visits/[id]` detail page accessible to any role for visits at their own site. Owner manages `material_types` and `machines` config tables.

**Tech Stack:** Next.js 16 App Router + TypeScript + Tailwind v4, Supabase (Postgres + Auth + RLS), Vitest for tests, React 19 server actions with `useActionState`.

**Spec:** `docs/superpowers/specs/2026-05-29-phase-2-visit-workflow-design.md`

**Branch:** `phase-2-visit-workflow` (off `main`; spec already committed as `e683382`)

---

## Pre-flight

- [ ] **P1: Verify Phase 1 state is green**

```bash
git status                              # Should be clean except this plan
git rev-parse --abbrev-ref HEAD         # Should be phase-2-visit-workflow
npx supabase status -o env | head -5    # Confirm local stack is up (or `npx supabase start`)
npm run test                            # All Phase 1 tests pass
npm run build                           # Clean build
```

Expected: 13 tests pass; build succeeds; on `phase-2-visit-workflow` branch.

- [ ] **P2: Confirm material-type seed list with Owner before Task 1**

The Owner needs to confirm the exact material types to seed (e.g. "Tin Ore", "Columbite", "Tantalite", "Lead", "Zinc"). Ask the user before running the migration. Default seed if not specified: `["Tin Ore", "Columbite", "Tantalite", "Lead Concentrate", "Zinc Concentrate"]`.

---

## Task 1: Migration 0006 — `material_types` table + RLS

**Files:**
- Create: `supabase/migrations/0006_material_types.sql`
- Create: `tests/rls/material-types.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0006_material_types.sql
create table public.material_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

alter table public.material_types enable row level security;

-- Anyone authenticated may read
create policy "material_types: read for authenticated"
  on public.material_types
  for select to authenticated
  using (true);

-- Owner-only writes
create policy "material_types: owner inserts"
  on public.material_types
  for insert to authenticated
  with check (public.is_owner());

create policy "material_types: owner updates"
  on public.material_types
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "material_types: owner deletes"
  on public.material_types
  for delete to authenticated
  using (public.is_owner());

-- Seed (Owner confirms list pre-migration; defaults below)
insert into public.material_types (name) values
  ('Tin Ore'),
  ('Columbite'),
  ('Tantalite'),
  ('Lead Concentrate'),
  ('Zinc Concentrate');
```

- [ ] **Step 2: Apply and verify clean reset**

```bash
npx supabase db reset
```

Expected: All 6 migrations apply with no errors. `material_types` table exists with 5 seeded rows.

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/material-types.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("material_types RLS", () => {
  let siteId: string;
  let gate: TestUser, owner: TestUser;

  beforeAll(async () => {
    siteId = await firstSiteId();
    gate = await makeUser({ username: "mt-gate", role: "gate", siteId });
    owner = await makeUser({ username: "mt-owner", role: "owner", siteId: null });
  });

  it("any authenticated user can read material_types", async () => {
    const { data, error } = await gate.client.from("material_types").select("id, name").limit(5);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });

  it("non-owner cannot insert material_types", async () => {
    const { error } = await gate.client.from("material_types").insert({ name: "Coltan" });
    expect(error).not.toBeNull();
  });

  it("owner can insert material_types", async () => {
    const { error } = await owner.client.from("material_types").insert({ name: "Wolframite" });
    expect(error).toBeNull();
  });

  it("non-owner cannot update material_types", async () => {
    const { data: row } = await adminClient.from("material_types").select("id").limit(1).single();
    const { error } = await gate.client
      .from("material_types")
      .update({ active: false })
      .eq("id", row!.id);
    // Update silently affects 0 rows due to RLS — verify by re-reading
    const { data: after } = await adminClient
      .from("material_types").select("active").eq("id", row!.id).single();
    expect(after?.active).toBe(true);
  });

  it("owner can soft-delete (set active=false)", async () => {
    const { data: row } = await adminClient.from("material_types").select("id").limit(1).single();
    const { error } = await owner.client
      .from("material_types")
      .update({ active: false })
      .eq("id", row!.id);
    expect(error).toBeNull();
    const { data: after } = await adminClient
      .from("material_types").select("active").eq("id", row!.id).single();
    expect(after?.active).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- tests/rls/material-types.rls.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_material_types.sql tests/rls/material-types.rls.test.ts
git commit -m "feat(db): add material_types table with owner-only writes

Phase 2 Task 1. Owner-managed enum of material types for gate intake.
Soft-delete via active=false so closed visits keep valid FK references.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration 0007 — `suppliers` table + RLS

**Files:**
- Create: `supabase/migrations/0007_suppliers.sql`
- Create: `tests/rls/suppliers.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0007_suppliers.sql
create extension if not exists pg_trgm;

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

create index suppliers_phone_idx on public.suppliers (phone);
create index suppliers_name_idx  on public.suppliers using gin (name gin_trgm_ops);

alter table public.suppliers enable row level security;

-- Any authenticated user can read (global lookup)
create policy "suppliers: read for authenticated"
  on public.suppliers
  for select to authenticated
  using (true);

-- Any authenticated user can insert (gate adds new on the fly)
create policy "suppliers: insert for authenticated"
  on public.suppliers
  for insert to authenticated
  with check (auth.uid() is not null);

-- Only owner can update/delete
create policy "suppliers: owner updates"
  on public.suppliers
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "suppliers: owner deletes"
  on public.suppliers
  for delete to authenticated
  using (public.is_owner());
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

Expected: All migrations apply cleanly; `pg_trgm` extension is enabled.

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/suppliers.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("suppliers RLS", () => {
  let siteId: string;
  let gateA: TestUser, gateB: TestUser, owner: TestUser;

  beforeAll(async () => {
    siteId = await firstSiteId();
    const { data: sites } = await adminClient.from("sites").select("id").limit(2);
    const siteAId = sites![0].id;
    const siteBId = sites![1].id;
    gateA = await makeUser({ username: "sup-gate-a", role: "gate", siteId: siteAId });
    gateB = await makeUser({ username: "sup-gate-b", role: "gate", siteId: siteBId });
    owner = await makeUser({ username: "sup-owner", role: "owner", siteId: null });
  });

  it("any role can insert a supplier", async () => {
    const { data, error } = await gateA.client
      .from("suppliers").insert({ name: "Musa Abubakar", phone: "07012345678" })
      .select("id").single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("suppliers are visible across sites (global)", async () => {
    await gateA.client.from("suppliers").insert({ name: "Cross Site Supplier", phone: "07099999999" });
    const { data, error } = await gateB.client
      .from("suppliers").select("id, name").eq("phone", "07099999999");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("non-owner cannot update a supplier", async () => {
    const { data: row } = await adminClient
      .from("suppliers").insert({ name: "Editable", phone: "07088000000" }).select("id").single();
    await gateA.client.from("suppliers").update({ name: "Changed" }).eq("id", row!.id);
    const { data: after } = await adminClient.from("suppliers").select("name").eq("id", row!.id).single();
    expect(after?.name).toBe("Editable");
  });

  it("owner can update a supplier", async () => {
    const { data: row } = await adminClient
      .from("suppliers").insert({ name: "Owner-editable", phone: "07077000000" }).select("id").single();
    const { error } = await owner.client.from("suppliers").update({ name: "Updated" }).eq("id", row!.id);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- tests/rls/suppliers.rls.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_suppliers.sql tests/rls/suppliers.rls.test.ts
git commit -m "feat(db): add global suppliers table with trigram name search

Phase 2 Task 2. Suppliers are global (no site_id); any authenticated
user can read/insert; owner-only update/delete. pg_trgm enables
fuzzy name search at the gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migration 0008 — `machines` table + RLS

**Files:**
- Create: `supabase/migrations/0008_machines.sql`
- Create: `tests/rls/machines.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0008_machines.sql
create table public.machines (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id),
  name          text not null,
  charge_basis  text not null check (charge_basis in ('weight','bag','hour')),
  rate          numeric(12,2) not null check (rate >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (site_id, name)
);

create index machines_site_idx on public.machines (site_id);

alter table public.machines enable row level security;

-- Non-owner: read own site only
create policy "machines: read own site"
  on public.machines
  for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

-- Owner-only writes
create policy "machines: owner inserts"
  on public.machines
  for insert to authenticated
  with check (public.is_owner());

create policy "machines: owner updates"
  on public.machines
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "machines: owner deletes"
  on public.machines
  for delete to authenticated
  using (public.is_owner());
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/machines.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("machines RLS", () => {
  let siteAId: string, siteBId: string;
  let procA: TestUser, procB: TestUser, owner: TestUser;
  let machineAId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(2);
    siteAId = sites![0].id;
    siteBId = sites![1].id;
    procA = await makeUser({ username: "mach-proc-a", role: "processing", siteId: siteAId });
    procB = await makeUser({ username: "mach-proc-b", role: "processing", siteId: siteBId });
    owner = await makeUser({ username: "mach-owner", role: "owner", siteId: null });

    const { data: machine } = await adminClient.from("machines")
      .insert({ site_id: siteAId, name: "Crusher #1", charge_basis: "weight", rate: 15.0 })
      .select("id").single();
    machineAId = machine!.id;
  });

  it("processing at site A sees site A machines", async () => {
    const { data, error } = await procA.client.from("machines").select("id, name").eq("id", machineAId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("processing at site B does NOT see site A machines", async () => {
    const { data, error } = await procB.client.from("machines").select("id").eq("id", machineAId);
    expect(error).toBeNull();
    expect(data?.length).toBe(0);
  });

  it("non-owner cannot insert a machine", async () => {
    const { error } = await procA.client
      .from("machines")
      .insert({ site_id: siteAId, name: "Sneaky", charge_basis: "bag", rate: 100 });
    expect(error).not.toBeNull();
  });

  it("owner can insert a machine at any site", async () => {
    const { error } = await owner.client
      .from("machines")
      .insert({ site_id: siteBId, name: "Mag-Separator", charge_basis: "hour", rate: 5000 });
    expect(error).toBeNull();
  });

  it("owner can see machines across all sites", async () => {
    const { data, error } = await owner.client.from("machines").select("id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- tests/rls/machines.rls.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_machines.sql tests/rls/machines.rls.test.ts
git commit -m "feat(db): add machines table with per-site visibility, owner-only writes

Phase 2 Task 3. Each machine has charge_basis (weight/bag/hour) and
rate. RLS gives non-owner read-only access to own-site machines;
owner has full CRUD across sites.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migration 0009 — `transaction_events` table + `jsonb_diff_changed` helper

**Files:**
- Create: `supabase/migrations/0009_transaction_events.sql`
- Create: `tests/audit/diff-helper.test.ts`
- Create: `tests/rls/transaction-events.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0009_transaction_events.sql

-- Helper: return only the keys that changed between two JSONB blobs.
create or replace function public.jsonb_diff_changed(old jsonb, new jsonb)
  returns jsonb
  language sql
  immutable
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', old->k, 'new', new->k)), '{}'::jsonb)
  from jsonb_object_keys(coalesce(new, '{}'::jsonb)) k
  where (old->k) is distinct from (new->k);
$$;

-- Audit log table. Insert is restricted to triggers (SECURITY DEFINER).
create table public.transaction_events (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null,  -- FK added in migration 0010 after visits exists
  event_type  text not null check (event_type in (
                'visit_created','state_changed','record_created','record_edited',
                'gate_exit_authorized','gate_released','owner_override')),
  actor_id    uuid references public.profiles(id),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index transaction_events_visit_idx on public.transaction_events (visit_id, created_at);

alter table public.transaction_events enable row level security;

-- Read: only via visits row visibility (added after visits exists; for now, owner-only)
create policy "transaction_events: owner reads all"
  on public.transaction_events
  for select to authenticated
  using (public.is_owner());

-- No client INSERT/UPDATE/DELETE policies → all DML denied by default.
-- Triggers will be SECURITY DEFINER so they can insert despite RLS.
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

- [ ] **Step 3: Write diff-helper test**

```typescript
// tests/audit/diff-helper.test.ts
import { describe, it, expect } from "vitest";
import { adminClient } from "../setup/supabase-test-clients";

describe("jsonb_diff_changed", () => {
  async function diff(old: object, neu: object): Promise<Record<string, { old: unknown; new: unknown }>> {
    const { data, error } = await adminClient.rpc("jsonb_diff_changed", {
      old: old as object,
      new: neu as object,
    });
    expect(error).toBeNull();
    return data as Record<string, { old: unknown; new: unknown }>;
  }

  it("returns empty object when nothing changed", async () => {
    expect(await diff({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual({});
  });

  it("returns only changed keys", async () => {
    const d = await diff({ a: 1, b: "x", c: true }, { a: 2, b: "x", c: false });
    expect(d).toEqual({
      a: { old: 1, new: 2 },
      c: { old: true, new: false },
    });
  });

  it("captures new keys in 'new' with old=null", async () => {
    const d = await diff({ a: 1 }, { a: 1, b: 2 });
    expect(d).toEqual({ b: { old: null, new: 2 } });
  });
});
```

- [ ] **Step 4: Write RLS test for transaction_events**

```typescript
// tests/rls/transaction-events.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("transaction_events RLS (pre-visits)", () => {
  let gate: TestUser, owner: TestUser;

  beforeAll(async () => {
    const siteId = await firstSiteId();
    gate = await makeUser({ username: "te-gate", role: "gate", siteId });
    owner = await makeUser({ username: "te-owner", role: "owner", siteId: null });
  });

  it("non-owner cannot directly INSERT transaction_events", async () => {
    const { error } = await gate.client.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000000",
      event_type: "visit_created",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  it("owner cannot directly INSERT either (no INSERT policy)", async () => {
    const { error } = await owner.client.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000000",
      event_type: "visit_created",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  it("owner SELECT returns rows when admin seeds one", async () => {
    await adminClient.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000001",
      event_type: "visit_created",
      payload: { seeded: true },
    });
    const { data, error } = await owner.client
      .from("transaction_events").select("payload").eq("payload->>seeded", "true");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npm run test -- tests/audit/diff-helper.test.ts tests/rls/transaction-events.rls.test.ts
```

Expected: 6 passing total.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0009_transaction_events.sql tests/audit/diff-helper.test.ts tests/rls/transaction-events.rls.test.ts
git commit -m "feat(db): add transaction_events audit log + jsonb_diff_changed helper

Phase 2 Task 4. Append-only audit log; client DML denied (only
SECURITY DEFINER triggers will write rows). Owner-only SELECT for
now; per-site SELECT policy added in 0010 once visits exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Migration 0010 — `visits` table + `visit_is_open` + state-machine trigger + visit-audit trigger

**Files:**
- Create: `supabase/migrations/0010_visits.sql`
- Create: `tests/state-machine/transitions.test.ts`
- Create: `tests/rls/visits.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0010_visits.sql

create table public.visits (
  id                          uuid primary key default gen_random_uuid(),
  site_id                     uuid not null references public.sites(id),
  supplier_id                 uuid not null references public.suppliers(id),
  vehicle_plate               text,
  declared_material_type_id   uuid not null references public.material_types(id),
  entry_path                  text not null check (entry_path in ('unprocessed','pre_processed')),
  state                       text not null check (state in (
                                 'at_gate_in','in_processing','in_receiving','pricing',
                                 'in_accounting','awaiting_gate_exit','exited',
                                 'awaiting_stock_intake','stocked')),
  created_at                  timestamptz not null default now(),
  created_by                  uuid not null references public.profiles(id),
  closed_at                   timestamptz
);

create index visits_site_state_idx on public.visits (site_id, state);
create index visits_supplier_idx   on public.visits (supplier_id);

-- Now that visits exists, add the deferred FK on transaction_events.
alter table public.transaction_events
  add constraint transaction_events_visit_id_fkey
  foreign key (visit_id) references public.visits(id) on delete cascade;

-- Replace owner-only read policy with site-scoped per-visit read.
drop policy if exists "transaction_events: owner reads all" on public.transaction_events;
create policy "transaction_events: read by visit visibility"
  on public.transaction_events
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = transaction_events.visit_id
                 and v.site_id = public.current_site())
  );

-- Helper used by child-record RLS update policies.
create or replace function public.visit_is_open(_visit_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select state not in ('exited','stocked') from public.visits where id = _visit_id;
$$;

-- ─── State-machine validation (BEFORE UPDATE OF state) ──────────────────
create or replace function public._visits_validate_transition()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  is_legal boolean;
  is_owner boolean := public.is_owner();
  has_analysis boolean;
  has_authorization boolean;
begin
  if NEW.state = OLD.state then
    return NEW;
  end if;

  -- Allowed forward transitions
  is_legal := (OLD.state, NEW.state) in (
    ('at_gate_in','in_processing'),
    ('at_gate_in','in_receiving'),
    ('in_processing','in_receiving'),
    ('in_receiving','pricing'),
    ('pricing','in_accounting'),
    ('pricing','awaiting_gate_exit'),
    ('awaiting_gate_exit','exited'),
    ('in_accounting','awaiting_stock_intake'),
    ('awaiting_stock_intake','stocked')
  );

  if not is_legal and not is_owner then
    raise exception 'illegal state transition: % → %', OLD.state, NEW.state
      using errcode = '22000';
  end if;

  -- Invariants on forward transitions
  if NEW.state = 'pricing' then
    select exists (select 1 from public.analysis_records where visit_id = NEW.id) into has_analysis;
    if not has_analysis then
      raise exception 'cannot enter pricing without analysis_records row';
    end if;
  end if;

  if NEW.state = 'exited' and OLD.state = 'awaiting_gate_exit' then
    select exists (select 1 from public.gate_exit_authorizations where visit_id = NEW.id) into has_authorization;
    if not has_authorization then
      raise exception 'cannot exit without gate_exit_authorizations row';
    end if;
  end if;

  -- Terminal entry sets closed_at
  if NEW.state in ('exited','stocked') and OLD.state not in ('exited','stocked') then
    NEW.closed_at := now();
  end if;

  return NEW;
end;
$$;

create trigger t_visits_state_machine
  before update of state on public.visits
  for each row execute function public._visits_validate_transition();

-- ─── Visit audit trigger (AFTER INSERT / AFTER UPDATE OF state) ─────────
create or replace function public._visits_write_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  is_backward boolean := false;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.id, 'visit_created', NEW.created_by,
      jsonb_build_object(
        'entry_path', NEW.entry_path,
        'supplier_id', NEW.supplier_id,
        'declared_material_type_id', NEW.declared_material_type_id,
        'vehicle_plate', NEW.vehicle_plate,
        'site_id', NEW.site_id
      )
    );
    return NEW;
  end if;

  if NEW.state <> OLD.state then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (
      NEW.id, 'state_changed', auth.uid(),
      jsonb_build_object('from', OLD.state, 'to', NEW.state)
    );

    -- Owner-override detection: owner moved backward
    if public.is_owner() and (OLD.state, NEW.state) not in (
      ('at_gate_in','in_processing'),
      ('at_gate_in','in_receiving'),
      ('in_processing','in_receiving'),
      ('in_receiving','pricing'),
      ('pricing','in_accounting'),
      ('pricing','awaiting_gate_exit'),
      ('awaiting_gate_exit','exited'),
      ('in_accounting','awaiting_stock_intake'),
      ('awaiting_stock_intake','stocked')
    ) then
      insert into public.transaction_events (visit_id, event_type, actor_id, payload)
      values (NEW.id, 'owner_override', auth.uid(),
              jsonb_build_object('table', 'visits', 'from', OLD.state, 'to', NEW.state));
    end if;
  end if;

  return NEW;
end;
$$;

create trigger t_visits_audit_insert
  after insert on public.visits
  for each row execute function public._visits_write_audit();

create trigger t_visits_audit_update
  after update of state on public.visits
  for each row execute function public._visits_write_audit();

-- ─── RLS on visits ──────────────────────────────────────────────────────
alter table public.visits enable row level security;

-- Read: own site for non-owner, all sites for owner
create policy "visits: read own site"
  on public.visits
  for select to authenticated
  using (site_id = public.current_site() or public.is_owner());

-- Insert: gate role only, on own site
create policy "visits: gate inserts own site"
  on public.visits
  for insert to authenticated
  with check (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.is_owner()
  );

-- Update: column-level grants control which fields each role may set.
-- Table-level UPDATE policy is restrictive — only gate (own site) + owner.
create policy "visits: gate updates own site"
  on public.visits
  for update to authenticated
  using (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.is_owner()
  )
  with check (
    (public.current_role() = 'gate' and site_id = public.current_site())
    or public.is_owner()
  );

-- Triggers update visits.state on behalf of other roles; SECURITY DEFINER bypasses RLS.

-- Column-level GRANTs:
-- Phase 1 used REVOKE + column GRANT on profiles. Same pattern here.
revoke update on public.visits from authenticated;
grant update (supplier_id, vehicle_plate, declared_material_type_id, entry_path, state) on public.visits to authenticated;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

Expected: All 10 migrations apply cleanly.

- [ ] **Step 3: Write state-machine test**

```typescript
// tests/state-machine/transitions.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("visits state machine — transitions", () => {
  let siteId: string;
  let gate: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate = await makeUser({ username: "sm-gate", role: "gate", siteId });
    owner = await makeUser({ username: "sm-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient
      .from("suppliers").insert({ name: "SM Supplier", phone: "07000000000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  async function newVisit(entryPath: "unprocessed" | "pre_processed") {
    const { data, error } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: entryPath, state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    expect(error).toBeNull();
    return data!.id;
  }

  it("at_gate_in → in_processing is allowed", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await gate.client.from("visits").update({ state: "in_processing" }).eq("id", id);
    expect(error).toBeNull();
  });

  it("at_gate_in → pricing is REJECTED (illegal jump)", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await gate.client.from("visits").update({ state: "pricing" }).eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/illegal state transition/);
  });

  it("in_receiving → pricing is REJECTED without analysis_records row", async () => {
    const id = await newVisit("pre_processed");  // goes to in_receiving directly
    // gate role inserted with state=at_gate_in; transition to in_receiving via owner (server action does this normally)
    await owner.client.from("visits").update({ state: "in_receiving" }).eq("id", id);
    const { error } = await owner.client.from("visits").update({ state: "pricing" }).eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/analysis_records/);
  });

  it("owner can move state backward (logs owner_override event)", async () => {
    const id = await newVisit("unprocessed");
    await owner.client.from("visits").update({ state: "in_processing" }).eq("id", id);
    const { error } = await owner.client.from("visits").update({ state: "at_gate_in" }).eq("id", id);
    expect(error).toBeNull();
    const { data: events } = await adminClient
      .from("transaction_events").select("event_type").eq("visit_id", id).order("created_at", { ascending: true });
    expect(events!.map(e => e.event_type)).toContain("owner_override");
  });

  it("entering exited sets closed_at", async () => {
    // Need to walk a visit through to awaiting_gate_exit then add an authorization row
    const id = await newVisit("pre_processed");
    await owner.client.from("visits").update({ state: "in_receiving" }).eq("id", id);
    // Skip the analysis/pricing dance — owner override the rest
    await owner.client.from("visits").update({ state: "awaiting_gate_exit" }).eq("id", id);
    // Authorize
    await owner.client.from("gate_exit_authorizations").insert({ visit_id: id, authorized_by: owner.userId });
    const { error } = await owner.client.from("visits").update({ state: "exited" }).eq("id", id);
    expect(error).toBeNull();
    const { data: v } = await adminClient.from("visits").select("closed_at").eq("id", id).single();
    expect(v?.closed_at).not.toBeNull();
  });
});
```

> Note: this test depends on `gate_exit_authorizations` (Task 9). The state-machine test for `exited` is moved into integration tests later if Task 9 hasn't landed. For Task 5, **comment out the "entering exited" test** and unskip it after Task 9.

- [ ] **Step 4: Write visits RLS test**

```typescript
// tests/rls/visits.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("visits RLS", () => {
  let siteAId: string, siteBId: string;
  let gateA: TestUser, gateB: TestUser, procA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(2);
    siteAId = sites![0].id;
    siteBId = sites![1].id;
    gateA = await makeUser({ username: "v-gate-a", role: "gate", siteId: siteAId });
    gateB = await makeUser({ username: "v-gate-b", role: "gate", siteId: siteBId });
    procA = await makeUser({ username: "v-proc-a", role: "processing", siteId: siteAId });
    owner = await makeUser({ username: "v-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient
      .from("suppliers").insert({ name: "V Supplier", phone: "07011110000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  async function insertVisitAs(user: TestUser, siteId: string) {
    return user.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "unprocessed", state: "at_gate_in", created_by: user.userId,
    }).select("id").single();
  }

  it("gate can insert a visit at own site", async () => {
    const { error } = await insertVisitAs(gateA, siteAId);
    expect(error).toBeNull();
  });

  it("gate cannot insert a visit at another site", async () => {
    const { error } = await insertVisitAs(gateA, siteBId);
    expect(error).not.toBeNull();
  });

  it("processing role cannot insert a visit", async () => {
    const { error } = await insertVisitAs(procA, siteAId);
    expect(error).not.toBeNull();
  });

  it("gate at site A does NOT see site B visits", async () => {
    await insertVisitAs(gateB, siteBId);
    const { data } = await gateA.client.from("visits").select("id").eq("site_id", siteBId);
    expect(data?.length).toBe(0);
  });

  it("owner sees visits across all sites", async () => {
    const { data } = await owner.client.from("visits").select("id, site_id");
    expect(data?.length).toBeGreaterThan(0);
    const siteIds = new Set(data!.map(v => v.site_id));
    expect(siteIds.size).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npm run test -- tests/state-machine/transitions.test.ts tests/rls/visits.rls.test.ts
```

Expected: state-machine 4 passing (1 skipped pending Task 9); visits RLS 5 passing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0010_visits.sql tests/state-machine/transitions.test.ts tests/rls/visits.rls.test.ts
git commit -m "feat(db): add visits table, state machine, audit trigger

Phase 2 Task 5. Visits is the central object. BEFORE UPDATE trigger
validates state transitions against the allowed set and enforces
invariants (pricing needs analysis; exited needs authorization).
AFTER INSERT/UPDATE trigger writes visit_created / state_changed /
owner_override events to transaction_events.

Column-level UPDATE granted only on gate-editable fields + state.
RLS: read own-site for non-owner, all for owner; INSERT gate-only
on own site.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Migration 0011 — `processing_records` + `processing_machine_usage` + triggers

**Files:**
- Create: `supabase/migrations/0011_processing.sql`
- Create: `tests/rls/processing-records.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0011_processing.sql

create table public.processing_records (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null unique references public.visits(id) on delete cascade,
  recorded_by   uuid not null references public.profiles(id),
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.processing_machine_usage (
  id                     uuid primary key default gen_random_uuid(),
  processing_record_id   uuid not null references public.processing_records(id) on delete cascade,
  machine_id             uuid not null references public.machines(id),
  measurement            numeric(12,3) not null check (measurement >= 0),
  rate_snapshot          numeric(12,2) not null check (rate_snapshot >= 0),
  line_cost              numeric(14,2) generated always as (measurement * rate_snapshot) stored
);

create index pmu_record_idx on public.processing_machine_usage (processing_record_id);

-- ─── Trigger: audit + transition visit on processing insert ────────────
create or replace function public._processing_records_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
begin
  if TG_OP = 'INSERT' then
    -- Audit
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'processing_records', 'record_id', NEW.id));

    -- Transition: in_processing → in_receiving
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'in_processing' then
      update public.visits set state = 'in_receiving' where id = NEW.visit_id;
    end if;

    return NEW;
  end if;

  -- UPDATE: record_edited
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'processing_records',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));
  return NEW;
end;
$$;

create trigger t_processing_records_audit
  after insert or update on public.processing_records
  for each row execute function public._processing_records_after();

-- Bumping updated_at on UPDATE
create or replace function public._touch_updated_at()
  returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end;
$$;

create trigger t_processing_records_touch
  before update on public.processing_records
  for each row execute function public._touch_updated_at();

-- ─── RLS on processing_records ──────────────────────────────────────────
alter table public.processing_records enable row level security;

create policy "processing_records: read own site"
  on public.processing_records
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = processing_records.visit_id
                 and v.site_id = public.current_site())
  );

create policy "processing_records: processing inserts on own site, state=in_processing"
  on public.processing_records
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = processing_records.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_processing')
    )
  );

create policy "processing_records: processing updates own site while open"
  on public.processing_records
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = processing_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(processing_records.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.visits v
                  where v.id = processing_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(processing_records.visit_id)
    )
  );

-- ─── RLS on processing_machine_usage (inherits via parent) ─────────────
alter table public.processing_machine_usage enable row level security;

create policy "pmu: read via parent"
  on public.processing_machine_usage
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.processing_records pr
               join public.visits v on v.id = pr.visit_id
               where pr.id = processing_machine_usage.processing_record_id
                 and v.site_id = public.current_site())
  );

create policy "pmu: write via parent"
  on public.processing_machine_usage
  for all to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.processing_records pr
                  join public.visits v on v.id = pr.visit_id
                  where pr.id = processing_machine_usage.processing_record_id
                    and v.site_id = public.current_site()
                    and public.visit_is_open(pr.visit_id))
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'processing'
      and exists (select 1 from public.processing_records pr
                  join public.visits v on v.id = pr.visit_id
                  where pr.id = processing_machine_usage.processing_record_id
                    and v.site_id = public.current_site()
                    and public.visit_is_open(pr.visit_id))
    )
  );
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/processing-records.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("processing_records RLS + state transition", () => {
  let siteAId: string, siteBId: string;
  let gateA: TestUser, procA: TestUser, procB: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string, machineAId: string;

  async function newOpenVisit(siteId: string) {
    const { data } = await adminClient.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "unprocessed", state: "in_processing", created_by: gateA.userId,
    }).select("id").single();
    return data!.id;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(2);
    siteAId = sites![0].id; siteBId = sites![1].id;
    gateA  = await makeUser({ username: "pr-gate-a", role: "gate",       siteId: siteAId });
    procA  = await makeUser({ username: "pr-proc-a", role: "processing", siteId: siteAId });
    procB  = await makeUser({ username: "pr-proc-b", role: "processing", siteId: siteBId });
    owner  = await makeUser({ username: "pr-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "PR Supp", phone: "07022220000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
    const { data: machine } = await adminClient.from("machines")
      .insert({ site_id: siteAId, name: "PR Crusher", charge_basis: "weight", rate: 10 })
      .select("id").single();
    machineAId = machine!.id;
  });

  it("processing at site A can insert when visit is in_processing", async () => {
    const vid = await newOpenVisit(siteAId);
    const { error } = await procA.client.from("processing_records")
      .insert({ visit_id: vid, recorded_by: procA.userId });
    expect(error).toBeNull();
  });

  it("processing insert transitions visit in_processing → in_receiving", async () => {
    const vid = await newOpenVisit(siteAId);
    await procA.client.from("processing_records")
      .insert({ visit_id: vid, recorded_by: procA.userId });
    const { data } = await adminClient.from("visits").select("state").eq("id", vid).single();
    expect(data?.state).toBe("in_receiving");
  });

  it("processing at site B cannot insert against site A visit", async () => {
    const vid = await newOpenVisit(siteAId);
    const { error } = await procB.client.from("processing_records")
      .insert({ visit_id: vid, recorded_by: procB.userId });
    expect(error).not.toBeNull();
  });

  it("non-processing role cannot insert", async () => {
    const vid = await newOpenVisit(siteAId);
    const { error } = await gateA.client.from("processing_records")
      .insert({ visit_id: vid, recorded_by: gateA.userId });
    expect(error).not.toBeNull();
  });

  it("processing_machine_usage cascades RLS via parent", async () => {
    const vid = await newOpenVisit(siteAId);
    const { data: pr } = await procA.client.from("processing_records")
      .insert({ visit_id: vid, recorded_by: procA.userId }).select("id").single();
    const { error } = await procA.client.from("processing_machine_usage").insert({
      processing_record_id: pr!.id,
      machine_id: machineAId,
      measurement: 320, rate_snapshot: 10,
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- tests/rls/processing-records.rls.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_processing.sql tests/rls/processing-records.rls.test.ts
git commit -m "feat(db): add processing_records + processing_machine_usage

Phase 2 Task 6. One processing record per visit; multi-machine via
child usage table. Insert by processing role transitions visit
in_processing → in_receiving via SECURITY DEFINER trigger.
Line cost is a generated column from measurement × rate_snapshot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Migration 0012 — `analysis_records` + triggers

**Files:**
- Create: `supabase/migrations/0012_analysis.sql`
- Create: `tests/rls/analysis-records.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0012_analysis.sql

create table public.analysis_records (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null unique references public.visits(id) on delete cascade,
  weight            numeric(12,3) not null check (weight >= 0),
  sample_id         text,
  xrf_result        jsonb,
  purity            numeric(5,2) check (purity >= 0 and purity <= 100),
  grade             text,
  qc_observations   text,
  analyzed_at       timestamptz,
  recorded_by       uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create or replace function public._analysis_records_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.recorded_by,
            jsonb_build_object('table', 'analysis_records', 'record_id', NEW.id));

    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'in_receiving' then
      update public.visits set state = 'pricing' where id = NEW.visit_id;
    end if;
    return NEW;
  end if;

  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'record_edited', auth.uid(),
          jsonb_build_object(
            'table', 'analysis_records',
            'record_id', NEW.id,
            'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))
          ));

  -- If weight changed, recompute pricing.purchase_amount by touching the pricing row
  if NEW.weight is distinct from OLD.weight then
    update public.pricing set unit_price = unit_price where visit_id = NEW.visit_id;
  end if;

  return NEW;
end;
$$;

create trigger t_analysis_records_audit
  after insert or update on public.analysis_records
  for each row execute function public._analysis_records_after();

create trigger t_analysis_records_touch
  before update on public.analysis_records
  for each row execute function public._touch_updated_at();

alter table public.analysis_records enable row level security;

create policy "analysis_records: read own site"
  on public.analysis_records
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = analysis_records.visit_id
                 and v.site_id = public.current_site())
  );

create policy "analysis_records: receiving inserts when visit in_receiving"
  on public.analysis_records
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = analysis_records.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'in_receiving')
    )
  );

create policy "analysis_records: receiving updates own site while open"
  on public.analysis_records
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = analysis_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(analysis_records.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'receiving'
      and exists (select 1 from public.visits v
                  where v.id = analysis_records.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(analysis_records.visit_id)
    )
  );
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/analysis-records.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("analysis_records RLS + state transition", () => {
  let siteAId: string;
  let recvA: TestUser, procA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newReceivingVisit() {
    const { data } = await adminClient.from("visits").insert({
      site_id: siteAId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "in_receiving", created_by: recvA.userId,
    }).select("id").single();
    return data!.id;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteAId = sites![0].id;
    recvA  = await makeUser({ username: "ar-recv-a", role: "receiving",  siteId: siteAId });
    procA  = await makeUser({ username: "ar-proc-a", role: "processing", siteId: siteAId });
    owner  = await makeUser({ username: "ar-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "AR Supp", phone: "07033330000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("receiving can insert analysis on in_receiving visit at own site", async () => {
    const vid = await newReceivingVisit();
    const { error } = await recvA.client.from("analysis_records")
      .insert({ visit_id: vid, weight: 305, grade: "B+", purity: 58, recorded_by: recvA.userId });
    expect(error).toBeNull();
  });

  it("analysis insert transitions in_receiving → pricing", async () => {
    const vid = await newReceivingVisit();
    await recvA.client.from("analysis_records")
      .insert({ visit_id: vid, weight: 305, recorded_by: recvA.userId });
    const { data } = await adminClient.from("visits").select("state").eq("id", vid).single();
    expect(data?.state).toBe("pricing");
  });

  it("non-receiving role cannot insert analysis", async () => {
    const vid = await newReceivingVisit();
    const { error } = await procA.client.from("analysis_records")
      .insert({ visit_id: vid, weight: 305, recorded_by: procA.userId });
    expect(error).not.toBeNull();
  });

  it("receiving cannot insert analysis when visit is not in_receiving", async () => {
    const { data: v } = await adminClient.from("visits").insert({
      site_id: siteAId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "unprocessed", state: "in_processing", created_by: recvA.userId,
    }).select("id").single();
    const { error } = await recvA.client.from("analysis_records")
      .insert({ visit_id: v!.id, weight: 305, recorded_by: recvA.userId });
    expect(error).not.toBeNull();
  });

  it("editing weight writes a record_edited event", async () => {
    const vid = await newReceivingVisit();
    const { data: rec } = await recvA.client.from("analysis_records")
      .insert({ visit_id: vid, weight: 305, recorded_by: recvA.userId }).select("id").single();
    await recvA.client.from("analysis_records").update({ weight: 310 }).eq("id", rec!.id);
    const { data: events } = await adminClient.from("transaction_events")
      .select("event_type, payload").eq("visit_id", vid).eq("event_type", "record_edited");
    expect(events!.length).toBeGreaterThan(0);
    const diff = (events![0].payload as { diff: { weight?: { old: number; new: number } } }).diff;
    expect(diff.weight).toEqual({ old: 305, new: 310 });
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- tests/rls/analysis-records.rls.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_analysis.sql tests/rls/analysis-records.rls.test.ts
git commit -m "feat(db): add analysis_records with state-transition + audit triggers

Phase 2 Task 7. Receiving inserts the analysis (one per visit);
trigger transitions visit in_receiving → pricing. Weight edits
ripple into pricing.purchase_amount via a touch-update on the
pricing row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Migration 0013 — `pricing` + purchase_amount trigger + state transition

**Files:**
- Create: `supabase/migrations/0013_pricing.sql`
- Create: `tests/rls/pricing.rls.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0013_pricing.sql

create table public.pricing (
  id                  uuid primary key default gen_random_uuid(),
  visit_id            uuid not null unique references public.visits(id) on delete cascade,
  unit_price          numeric(12,2) check (unit_price >= 0),
  purchase_amount     numeric(14,2),
  agreement_status    text not null default 'pending'
                          check (agreement_status in ('pending','agreed','not_agreed')),
  payment_terms       text check (payment_terms in ('immediate','deferred','installment','deducted')),
  priced_by           uuid references public.profiles(id),
  overridden_by       uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint agreed_requires_price check (agreement_status <> 'agreed' or unit_price is not null),
  constraint agreed_requires_terms check (agreement_status <> 'agreed' or payment_terms is not null)
);

-- Maintain purchase_amount = unit_price × analysis_records.weight
create or replace function public._pricing_set_purchase_amount()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  w numeric;
begin
  select weight into w from public.analysis_records where visit_id = NEW.visit_id;
  if NEW.unit_price is null or w is null then
    NEW.purchase_amount := null;
  else
    NEW.purchase_amount := NEW.unit_price * w;
  end if;
  return NEW;
end;
$$;

create trigger t_pricing_purchase_amount
  before insert or update on public.pricing
  for each row execute function public._pricing_set_purchase_amount();

-- Audit + state transition
create or replace function public._pricing_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_state text;
  target_state text := null;
begin
  if TG_OP = 'INSERT' then
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_created', NEW.priced_by,
            jsonb_build_object('table', 'pricing', 'record_id', NEW.id,
                               'fields', jsonb_build_object(
                                 'unit_price', NEW.unit_price,
                                 'agreement_status', NEW.agreement_status,
                                 'payment_terms', NEW.payment_terms)));
  else
    insert into public.transaction_events (visit_id, event_type, actor_id, payload)
    values (NEW.visit_id, 'record_edited', auth.uid(),
            jsonb_build_object(
              'table', 'pricing', 'record_id', NEW.id,
              'diff', public.jsonb_diff_changed(to_jsonb(OLD), to_jsonb(NEW))));
  end if;

  if NEW.agreement_status = 'agreed'      then target_state := 'in_accounting'; end if;
  if NEW.agreement_status = 'not_agreed'  then target_state := 'awaiting_gate_exit'; end if;

  if target_state is not null then
    select state into v_state from public.visits where id = NEW.visit_id;
    if v_state = 'pricing' then
      update public.visits set state = target_state where id = NEW.visit_id;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger t_pricing_audit
  after insert or update on public.pricing
  for each row execute function public._pricing_after();

create trigger t_pricing_touch
  before update on public.pricing
  for each row execute function public._touch_updated_at();

alter table public.pricing enable row level security;

create policy "pricing: read own site"
  on public.pricing
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = pricing.visit_id
                 and v.site_id = public.current_site())
  );

create policy "pricing: manager inserts when visit pricing"
  on public.pricing
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = pricing.visit_id
                    and v.site_id = public.current_site()
                    and v.state = 'pricing')
    )
  );

create policy "pricing: manager updates own site while open"
  on public.pricing
  for update to authenticated
  using (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = pricing.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(pricing.visit_id)
    )
  )
  with check (
    public.is_owner()
    or (
      public.current_role() = 'manager'
      and exists (select 1 from public.visits v
                  where v.id = pricing.visit_id
                    and v.site_id = public.current_site())
      and public.visit_is_open(pricing.visit_id)
    )
  );
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/pricing.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("pricing RLS + transition + purchase_amount", () => {
  let siteAId: string;
  let mgrA: TestUser, recvA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newPricingVisitWithAnalysis(weight: number) {
    const { data: v } = await adminClient.from("visits").insert({
      site_id: siteAId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "in_receiving", created_by: mgrA.userId,
    }).select("id").single();
    await adminClient.from("analysis_records")
      .insert({ visit_id: v!.id, weight, recorded_by: recvA.userId });
    // analysis insert auto-transitions to pricing
    return v!.id;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteAId = sites![0].id;
    mgrA  = await makeUser({ username: "pp-mgr-a",  role: "manager",   siteId: siteAId });
    recvA = await makeUser({ username: "pp-recv-a", role: "receiving", siteId: siteAId });
    owner = await makeUser({ username: "pp-owner",  role: "owner",     siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "PP Supp", phone: "07044440000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("manager can insert pricing with agreement=agreed; visit transitions to in_accounting", async () => {
    const vid = await newPricingVisitWithAnalysis(300);
    const { error } = await mgrA.client.from("pricing").insert({
      visit_id: vid, unit_price: 1200, agreement_status: "agreed",
      payment_terms: "immediate", priced_by: mgrA.userId,
    });
    expect(error).toBeNull();
    const { data: v } = await adminClient.from("visits").select("state").eq("id", vid).single();
    expect(v?.state).toBe("in_accounting");
  });

  it("purchase_amount = unit_price × weight (computed)", async () => {
    const vid = await newPricingVisitWithAnalysis(250);
    await mgrA.client.from("pricing").insert({
      visit_id: vid, unit_price: 1500, agreement_status: "pending", priced_by: mgrA.userId,
    });
    const { data: p } = await adminClient.from("pricing").select("purchase_amount").eq("visit_id", vid).single();
    expect(Number(p?.purchase_amount)).toBe(250 * 1500);
  });

  it("agreed without unit_price violates CHECK constraint", async () => {
    const vid = await newPricingVisitWithAnalysis(100);
    const { error } = await mgrA.client.from("pricing").insert({
      visit_id: vid, agreement_status: "agreed", payment_terms: "immediate", priced_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("agreed without payment_terms violates CHECK constraint", async () => {
    const vid = await newPricingVisitWithAnalysis(100);
    const { error } = await mgrA.client.from("pricing").insert({
      visit_id: vid, unit_price: 1000, agreement_status: "agreed", priced_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("not_agreed transitions visit to awaiting_gate_exit", async () => {
    const vid = await newPricingVisitWithAnalysis(50);
    await mgrA.client.from("pricing").insert({
      visit_id: vid, agreement_status: "not_agreed", priced_by: mgrA.userId,
    });
    const { data: v } = await adminClient.from("visits").select("state").eq("id", vid).single();
    expect(v?.state).toBe("awaiting_gate_exit");
  });

  it("analysis weight edit recomputes purchase_amount", async () => {
    const vid = await newPricingVisitWithAnalysis(100);
    await mgrA.client.from("pricing").insert({
      visit_id: vid, unit_price: 2000, agreement_status: "pending", priced_by: mgrA.userId,
    });
    await adminClient.from("analysis_records").update({ weight: 110 }).eq("visit_id", vid);
    const { data: p } = await adminClient.from("pricing").select("purchase_amount").eq("visit_id", vid).single();
    expect(Number(p?.purchase_amount)).toBe(110 * 2000);
  });

  it("non-manager role cannot insert pricing", async () => {
    const vid = await newPricingVisitWithAnalysis(50);
    const { error } = await recvA.client.from("pricing").insert({
      visit_id: vid, unit_price: 1000, agreement_status: "pending", priced_by: recvA.userId,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- tests/rls/pricing.rls.test.ts
```

Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0013_pricing.sql tests/rls/pricing.rls.test.ts
git commit -m "feat(db): add pricing table with purchase_amount maintenance trigger

Phase 2 Task 8. Manager-only insert/update; visit state transitions
to in_accounting (agreed) or awaiting_gate_exit (not_agreed) via
SECURITY DEFINER trigger. purchase_amount = unit_price × analysis
weight, maintained by BEFORE INSERT/UPDATE trigger (subquery makes
a GENERATED column impossible). Analysis weight edits ripple
into purchase_amount via a no-op UPDATE on the pricing row.

CHECK constraints enforce agreed → unit_price + payment_terms set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Migration 0014 — `gate_exit_authorizations`

**Files:**
- Create: `supabase/migrations/0014_gate_exit_authorizations.sql`
- Create: `tests/rls/gate-exit-authorizations.rls.test.ts`
- Modify: `tests/state-machine/transitions.test.ts` (unskip the `exited` test)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0014_gate_exit_authorizations.sql

create table public.gate_exit_authorizations (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null unique references public.visits(id) on delete cascade,
  authorized_by   uuid not null references public.profiles(id),
  authorized_at   timestamptz not null default now(),
  note            text
);

create or replace function public._gate_exit_authorized_after()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.transaction_events (visit_id, event_type, actor_id, payload)
  values (NEW.visit_id, 'gate_exit_authorized', NEW.authorized_by,
          jsonb_build_object('authorized_by', NEW.authorized_by, 'note', NEW.note));
  return NEW;
end;
$$;

create trigger t_gate_exit_authorized
  after insert on public.gate_exit_authorizations
  for each row execute function public._gate_exit_authorized_after();

alter table public.gate_exit_authorizations enable row level security;

create policy "gea: read own site or owner"
  on public.gate_exit_authorizations
  for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.visits v
               where v.id = gate_exit_authorizations.visit_id
                 and v.site_id = public.current_site())
  );

create policy "gea: owner inserts only"
  on public.gate_exit_authorizations
  for insert to authenticated
  with check (public.is_owner());
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

- [ ] **Step 3: Write RLS test**

```typescript
// tests/rls/gate-exit-authorizations.rls.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("gate_exit_authorizations RLS", () => {
  let siteAId: string;
  let gateA: TestUser, mgrA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newAwaitingExitVisit() {
    const { data: v } = await adminClient.from("visits").insert({
      site_id: siteAId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "awaiting_gate_exit", created_by: gateA.userId,
    }).select("id").single();
    return v!.id;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteAId = sites![0].id;
    gateA = await makeUser({ username: "gea-gate-a", role: "gate",    siteId: siteAId });
    mgrA  = await makeUser({ username: "gea-mgr-a",  role: "manager", siteId: siteAId });
    owner = await makeUser({ username: "gea-owner",  role: "owner",   siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "GEA Supp", phone: "07055550000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("owner can insert authorization", async () => {
    const vid = await newAwaitingExitVisit();
    const { error } = await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: vid, authorized_by: owner.userId, note: "ok to leave" });
    expect(error).toBeNull();
  });

  it("non-owner cannot insert authorization", async () => {
    const vid = await newAwaitingExitVisit();
    const { error } = await mgrA.client.from("gate_exit_authorizations")
      .insert({ visit_id: vid, authorized_by: mgrA.userId });
    expect(error).not.toBeNull();
  });

  it("gate at site A can read authorization (to render Release button)", async () => {
    const vid = await newAwaitingExitVisit();
    await adminClient.from("gate_exit_authorizations").insert({ visit_id: vid, authorized_by: owner.userId });
    const { data, error } = await gateA.client
      .from("gate_exit_authorizations").select("id").eq("visit_id", vid);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("inserting authorization writes gate_exit_authorized event", async () => {
    const vid = await newAwaitingExitVisit();
    await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: vid, authorized_by: owner.userId, note: "audit-test" });
    const { data } = await adminClient.from("transaction_events")
      .select("event_type, payload").eq("visit_id", vid).eq("event_type", "gate_exit_authorized");
    expect(data?.length).toBe(1);
    expect((data![0].payload as { note: string }).note).toBe("audit-test");
  });

  it("after authorization, gate can transition state to exited", async () => {
    const vid = await newAwaitingExitVisit();
    await owner.client.from("gate_exit_authorizations").insert({ visit_id: vid, authorized_by: owner.userId });
    const { error } = await gateA.client.from("visits").update({ state: "exited" }).eq("id", vid);
    expect(error).toBeNull();
    const { data } = await adminClient.from("visits").select("state, closed_at").eq("id", vid).single();
    expect(data?.state).toBe("exited");
    expect(data?.closed_at).not.toBeNull();
  });

  it("without authorization, transition to exited is rejected", async () => {
    const vid = await newAwaitingExitVisit();
    const { error } = await gateA.client.from("visits").update({ state: "exited" }).eq("id", vid);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/gate_exit_authorizations/);
  });
});
```

- [ ] **Step 4: Unskip the previously-deferred state-machine test**

In `tests/state-machine/transitions.test.ts`, the "entering exited sets closed_at" test should now run as-is. Remove any `.skip` markers.

- [ ] **Step 5: Run the tests**

```bash
npm run test -- tests/rls/gate-exit-authorizations.rls.test.ts tests/state-machine/transitions.test.ts
```

Expected: 6 passing in gate-exit + 5 in state-machine.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0014_gate_exit_authorizations.sql tests/rls/gate-exit-authorizations.rls.test.ts tests/state-machine/transitions.test.ts
git commit -m "feat(db): add gate_exit_authorizations table

Phase 2 Task 9. Owner-only INSERT; non-owner read scoped to own
site. Inserting an authorization writes a gate_exit_authorized
event. Once the row exists, the gate role can transition the
visit from awaiting_gate_exit → exited (state-machine trigger
validates this invariant).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: TypeScript types + shared visit library

**Files:**
- Create: `src/lib/visits/state-machine.ts`
- Create: `src/lib/visits/queries.ts`
- Create: `src/lib/visits/format.ts`
- Create: `tests/lib/state-machine.test.ts`

- [ ] **Step 1: Write the state-machine TS module**

```typescript
// src/lib/visits/state-machine.ts
export const VISIT_STATES = [
  "at_gate_in",
  "in_processing",
  "in_receiving",
  "pricing",
  "in_accounting",
  "awaiting_gate_exit",
  "exited",
  "awaiting_stock_intake",
  "stocked",
] as const;

export type VisitState = (typeof VISIT_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<VisitState> = new Set(["exited", "stocked"]);

const FORWARD_TRANSITIONS: ReadonlyArray<readonly [VisitState, VisitState]> = [
  ["at_gate_in", "in_processing"],
  ["at_gate_in", "in_receiving"],
  ["in_processing", "in_receiving"],
  ["in_receiving", "pricing"],
  ["pricing", "in_accounting"],
  ["pricing", "awaiting_gate_exit"],
  ["awaiting_gate_exit", "exited"],
  ["in_accounting", "awaiting_stock_intake"],
  ["awaiting_stock_intake", "stocked"],
];

export function isLegalForwardTransition(from: VisitState, to: VisitState): boolean {
  return FORWARD_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export function isVisitOpen(state: VisitState): boolean {
  return !TERMINAL_STATES.has(state);
}

export const STATE_LABELS: Record<VisitState, string> = {
  at_gate_in: "At gate (intake)",
  in_processing: "Processing",
  in_receiving: "Receiving / analysis",
  pricing: "Pricing",
  in_accounting: "Accounting",
  awaiting_gate_exit: "Awaiting gate exit",
  exited: "Exited",
  awaiting_stock_intake: "Awaiting stock intake",
  stocked: "Stocked",
};
```

- [ ] **Step 2: Write the queries helpers**

```typescript
// src/lib/visits/queries.ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { VisitState } from "./state-machine";

export type VisitQueueRow = {
  id: string;
  created_at: string;
  vehicle_plate: string | null;
  entry_path: "unprocessed" | "pre_processed";
  state: VisitState;
  supplier: { id: string; name: string; phone: string | null } | null;
  declared_material_type: { id: string; name: string } | null;
};

export async function listVisitsByState(states: VisitState[]): Promise<VisitQueueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, created_at, vehicle_plate, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name)
    `)
    .in("state", states)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VisitQueueRow[];
}

export async function listVisitsByStateWithAnalysis(state: VisitState): Promise<
  (VisitQueueRow & { analysis: { grade: string | null; weight: number; purity: number | null } | null })[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, created_at, vehicle_plate, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name),
      analysis:analysis_records(grade, weight, purity)
    `)
    .eq("state", state)
    .order("created_at", { ascending: true });
  if (error) throw error;
  // Supabase returns analysis as array; flatten to single (or null) since UNIQUE per visit
  return (data ?? []).map((r) => ({
    ...(r as unknown as VisitQueueRow),
    analysis: Array.isArray((r as { analysis: unknown[] }).analysis) && (r as { analysis: unknown[] }).analysis.length > 0
      ? ((r as { analysis: { grade: string | null; weight: number; purity: number | null }[] }).analysis[0])
      : null,
  }));
}
```

- [ ] **Step 3: Write the format helpers**

```typescript
// src/lib/visits/format.ts
export function formatNaira(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-NG", {
    style: "currency", currency: "NGN", maximumFractionDigits: 2,
  }).format(amount);
}

export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return "—";
  return `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 3 }).format(kg)} kg`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "medium", timeStyle: "short",
  });
}
```

- [ ] **Step 4: Write tests for state-machine**

```typescript
// tests/lib/state-machine.test.ts
import { describe, it, expect } from "vitest";
import {
  isLegalForwardTransition, isVisitOpen, TERMINAL_STATES, STATE_LABELS, VISIT_STATES,
} from "@/lib/visits/state-machine";

describe("state-machine TS mirror", () => {
  it("legal forward transitions match the DB allowed set", () => {
    expect(isLegalForwardTransition("at_gate_in", "in_processing")).toBe(true);
    expect(isLegalForwardTransition("at_gate_in", "in_receiving")).toBe(true);
    expect(isLegalForwardTransition("in_processing", "in_receiving")).toBe(true);
    expect(isLegalForwardTransition("in_receiving", "pricing")).toBe(true);
    expect(isLegalForwardTransition("pricing", "in_accounting")).toBe(true);
    expect(isLegalForwardTransition("pricing", "awaiting_gate_exit")).toBe(true);
    expect(isLegalForwardTransition("awaiting_gate_exit", "exited")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(isLegalForwardTransition("at_gate_in", "pricing")).toBe(false);
    expect(isLegalForwardTransition("in_processing", "pricing")).toBe(false);
  });

  it("identifies terminal states", () => {
    expect(TERMINAL_STATES.has("exited")).toBe(true);
    expect(TERMINAL_STATES.has("stocked")).toBe(true);
    expect(TERMINAL_STATES.has("pricing")).toBe(false);
  });

  it("isVisitOpen is the inverse of terminal", () => {
    expect(isVisitOpen("pricing")).toBe(true);
    expect(isVisitOpen("exited")).toBe(false);
    expect(isVisitOpen("stocked")).toBe(false);
  });

  it("STATE_LABELS covers every state", () => {
    for (const s of VISIT_STATES) {
      expect(STATE_LABELS[s]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npm run test -- tests/lib/state-machine.test.ts
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/visits/ tests/lib/state-machine.test.ts
git commit -m "feat(lib): add TS state-machine mirror + visit query helpers + formatters

Phase 2 Task 10. Pure-TS module mirroring the DB-side state machine
(used by UI to gate buttons and validate forms before submission).
Server-side query helpers for per-role queues. Naira / weight /
timestamp formatters for views.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Middleware update — allow `/visits/[id]` for all authenticated roles

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Read current middleware to confirm structure**

The file's current shape is captured in the session context. The relevant restriction:

```typescript
if (profile.role !== "owner" && !path.startsWith(home) && !PUBLIC_PATHS.includes(path)) {
  return redirectWithSession(req, res, home);
}
```

This blocks non-owner roles from any path that isn't their `home` or in `PUBLIC_PATHS`. We need to add `/visits/*` as a shared authenticated path that all roles can reach (RLS at the DB enforces what they actually see).

- [ ] **Step 2: Add `SHARED_AUTHENTICATED_PREFIXES` and use it in the role check**

```typescript
// src/middleware.ts (replace contents)
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ROLE_HOME, type Role } from "@/lib/auth/roles";

const PUBLIC_PATHS = ["/login", "/set-password"];
const SHARED_AUTHENTICATED_PREFIXES = ["/visits/"];

function redirectWithSession(req: NextRequest, res: NextResponse, to: string): NextResponse {
  const redirected = NextResponse.redirect(new URL(to, req.url));
  for (const c of res.cookies.getAll()) {
    redirected.cookies.set(c.name, c.value);
  }
  return redirected;
}

function isSharedAuthenticatedPath(path: string): boolean {
  return SHARED_AUTHENTICATED_PREFIXES.some((p) => path.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (!user) {
    if (PUBLIC_PATHS.includes(path)) return res;
    return redirectWithSession(req, res, "/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password, status")
    .eq("id", user.id)
    .single();

  if (!profile) return redirectWithSession(req, res, "/login");

  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return redirectWithSession(req, res, "/login");
  }

  if (profile.must_change_password && path !== "/set-password") {
    return redirectWithSession(req, res, "/set-password");
  }

  const home = ROLE_HOME[profile.role as Role];
  if (
    profile.role !== "owner"
    && !path.startsWith(home)
    && !PUBLIC_PATHS.includes(path)
    && !isSharedAuthenticatedPath(path)
  ) {
    return redirectWithSession(req, res, home);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)"],
};
```

- [ ] **Step 3: Verify the build still passes**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): allow /visits/* for all authenticated roles

Phase 2 Task 11. The shared visit detail page lives at /visits/[id]
and is reused by every role (RLS enforces site scope). Adds a
SHARED_AUTHENTICATED_PREFIXES allowlist so non-owner roles aren't
redirected away from /visits/* by the role-home redirect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Gate intake — server action + SupplierSearch component + form page

**Files:**
- Create: `src/app/(gate)/gate/intake/page.tsx`
- Create: `src/app/(gate)/gate/intake/IntakeForm.tsx`
- Create: `src/app/(gate)/gate/intake/SupplierSearch.tsx`
- Create: `src/app/(gate)/gate/actions.ts`
- Create: `tests/integration/gate-intake-action.test.ts`

- [ ] **Step 1: Write the server action**

```typescript
// src/app/(gate)/gate/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type IntakeState = { error?: string };

export async function submitGateIntake(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate") return { error: "Only gate can intake visits" };
  if (!me.site_id) return { error: "Gate user must be assigned to a site" };

  const supplierIdRaw = String(formData.get("supplier_id") ?? "").trim();
  const newSupplierName = String(formData.get("new_supplier_name") ?? "").trim();
  const newSupplierPhone = String(formData.get("new_supplier_phone") ?? "").trim();
  const newSupplierNotes = String(formData.get("new_supplier_notes") ?? "").trim();
  const vehiclePlate = String(formData.get("vehicle_plate") ?? "").trim() || null;
  const materialTypeId = String(formData.get("declared_material_type_id") ?? "").trim();
  const entryPath = String(formData.get("entry_path") ?? "").trim();

  if (!materialTypeId) return { error: "Material type is required" };
  if (entryPath !== "unprocessed" && entryPath !== "pre_processed") {
    return { error: "Entry path is required" };
  }

  const supabase = await createClient();

  let supplierId = supplierIdRaw;
  if (!supplierId) {
    if (!newSupplierName) return { error: "Supplier name is required (or pick an existing supplier)" };
    const { data: created, error: supErr } = await supabase
      .from("suppliers")
      .insert({
        name: newSupplierName,
        phone: newSupplierPhone || null,
        notes: newSupplierNotes || null,
        created_by: me.id,
      })
      .select("id")
      .single();
    if (supErr || !created) return { error: supErr?.message ?? "Failed to create supplier" };
    supplierId = created.id;
  }

  // Insert visit at_gate_in, then immediately transition to next state.
  const { data: visit, error: vErr } = await supabase
    .from("visits")
    .insert({
      site_id: me.site_id,
      supplier_id: supplierId,
      declared_material_type_id: materialTypeId,
      vehicle_plate: vehiclePlate,
      entry_path: entryPath,
      state: "at_gate_in",
      created_by: me.id,
    })
    .select("id")
    .single();
  if (vErr || !visit) return { error: vErr?.message ?? "Failed to create visit" };

  const nextState = entryPath === "unprocessed" ? "in_processing" : "in_receiving";
  const { error: tErr } = await supabase
    .from("visits")
    .update({ state: nextState })
    .eq("id", visit.id);
  if (tErr) return { error: tErr.message };

  redirect(`/visits/${visit.id}`);
}

export async function updateGateIntake(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const patch: Record<string, string | null> = {};
  const v = (k: string) => {
    const raw = formData.get(k);
    return raw == null ? null : String(raw).trim();
  };
  const vp = v("vehicle_plate"); if (vp != null) patch.vehicle_plate = vp || null;
  const dm = v("declared_material_type_id"); if (dm) patch.declared_material_type_id = dm;
  const ep = v("entry_path"); if (ep === "unprocessed" || ep === "pre_processed") patch.entry_path = ep;
  const sup = v("supplier_id"); if (sup) patch.supplier_id = sup;

  const supabase = await createClient();
  const { error } = await supabase.from("visits").update(patch).eq("id", visitId);
  if (error) return { error: error.message };
  return {};
}

export async function releaseVisit(visitId: string): Promise<IntakeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "gate" && me.role !== "owner") return { error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("visits")
    .update({ state: "exited" })
    .eq("id", visitId);
  if (error) return { error: error.message };
  return {};
}
```

- [ ] **Step 2: Write the SupplierSearch client component**

```tsx
// src/app/(gate)/gate/intake/SupplierSearch.tsx
"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type SupplierRow = { id: string; name: string; phone: string | null };

export function SupplierSearch({
  onSelect,
  onAddNew,
}: {
  onSelect: (s: SupplierRow) => void;
  onAddNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SupplierRow[]>([]);
  const [searching, startSearch] = useTransition();

  function runSearch() {
    if (!q.trim()) { setResults([]); return; }
    startSearch(async () => {
      const supabase = createClient();
      const term = q.trim();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .or(`phone.ilike.%${term}%,name.ilike.%${term}%`)
        .limit(10);
      setResults((data ?? []) as SupplierRow[]);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
          placeholder="Phone or name"
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="button" onClick={runSearch} className="px-3 py-2 border rounded">
          {searching ? "..." : "Search"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="border rounded divide-y">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
              >
                <span className="font-medium">{s.name}</span>
                {s.phone && <span className="ml-2 text-sm text-gray-500">{s.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && !searching && results.length === 0 && (
        <p className="text-sm text-gray-600">
          No match. <button type="button" className="underline" onClick={onAddNew}>Add new supplier</button>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the IntakeForm client component**

```tsx
// src/app/(gate)/gate/intake/IntakeForm.tsx
"use client";

import { useState, useActionState } from "react";
import { submitGateIntake, type IntakeState } from "../actions";
import { SupplierSearch } from "./SupplierSearch";

type MaterialType = { id: string; name: string };
type Supplier = { id: string; name: string; phone: string | null };

const initialState: IntakeState = {};

export function IntakeForm({ materialTypes }: { materialTypes: MaterialType[] }) {
  const [state, formAction, pending] = useActionState(submitGateIntake, initialState);
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  return (
    <form action={formAction} className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h2 className="font-semibold">Supplier</h2>
        {!picked && !addingNew && (
          <SupplierSearch
            onSelect={(s) => { setPicked(s); setAddingNew(false); }}
            onAddNew={() => { setAddingNew(true); setPicked(null); }}
          />
        )}
        {picked && (
          <div className="border rounded p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{picked.name}</div>
              <div className="text-sm text-gray-500">{picked.phone}</div>
            </div>
            <button type="button" className="underline text-sm" onClick={() => setPicked(null)}>Change</button>
            <input type="hidden" name="supplier_id" value={picked.id} />
          </div>
        )}
        {addingNew && (
          <div className="border rounded p-3 space-y-2">
            <input name="new_supplier_name" placeholder="Name" required className="w-full border rounded px-3 py-2" />
            <input name="new_supplier_phone" placeholder="Phone" className="w-full border rounded px-3 py-2" />
            <input name="new_supplier_notes" placeholder="Notes" className="w-full border rounded px-3 py-2" />
            <button type="button" className="underline text-sm" onClick={() => setAddingNew(false)}>Cancel</button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Visit</h2>
        <input name="vehicle_plate" placeholder="Vehicle plate" className="w-full border rounded px-3 py-2" />
        <select name="declared_material_type_id" required className="w-full border rounded px-3 py-2">
          <option value="">— select material —</option>
          {materialTypes.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <fieldset className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="entry_path" value="unprocessed" required /> Unprocessed
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="entry_path" value="pre_processed" required /> Pre-processed
          </label>
        </fieldset>
      </section>

      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}

      <button type="submit" disabled={pending} className="px-4 py-2 bg-black text-white rounded">
        {pending ? "Saving..." : "Save intake"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Write the intake page**

```tsx
// src/app/(gate)/gate/intake/page.tsx
import { createClient } from "@/lib/supabase/server";
import { IntakeForm } from "./IntakeForm";

export default async function GateIntakePage() {
  const supabase = await createClient();
  const { data: materialTypes } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">New visit intake</h1>
      <IntakeForm materialTypes={(materialTypes ?? []) as { id: string; name: string }[]} />
    </main>
  );
}
```

- [ ] **Step 5: Write an integration test for the action**

```typescript
// tests/integration/gate-intake-action.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("gate intake action — direct DB equivalent", () => {
  // The server action is hard to invoke from Vitest (needs Next request context).
  // We test the same sequence of DB writes the action performs, under the gate user's RLS.
  let gate: TestUser, siteId: string, materialTypeId: string;

  beforeAll(async () => {
    siteId = await firstSiteId();
    gate = await makeUser({ username: "gi-gate", role: "gate", siteId });
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("creates supplier + visit + transitions state in one logical step", async () => {
    // 1. Create supplier
    const { data: sup, error: supErr } = await gate.client
      .from("suppliers")
      .insert({ name: "Action Test Supp", phone: "07066660000", created_by: gate.userId })
      .select("id")
      .single();
    expect(supErr).toBeNull();

    // 2. Insert visit at_gate_in
    const { data: v, error: vErr } = await gate.client.from("visits").insert({
      site_id: siteId,
      supplier_id: sup!.id,
      declared_material_type_id: materialTypeId,
      vehicle_plate: "TEST-001",
      entry_path: "unprocessed",
      state: "at_gate_in",
      created_by: gate.userId,
    }).select("id").single();
    expect(vErr).toBeNull();

    // 3. Transition to in_processing
    const { error: tErr } = await gate.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);
    expect(tErr).toBeNull();

    // Verify events
    const { data: events } = await adminClient.from("transaction_events")
      .select("event_type").eq("visit_id", v!.id).order("created_at");
    expect(events!.map(e => e.event_type)).toEqual(["visit_created", "state_changed"]);
  });

  it("pre_processed path transitions to in_receiving", async () => {
    const { data: sup } = await gate.client.from("suppliers")
      .insert({ name: "Pre Supp", phone: "07077770000", created_by: gate.userId }).select("id").single();
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: sup!.id, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    const { data: after } = await adminClient.from("visits").select("state").eq("id", v!.id).single();
    expect(after?.state).toBe("in_receiving");
  });
});
```

- [ ] **Step 6: Run the test**

```bash
npm run test -- tests/integration/gate-intake-action.test.ts
```

Expected: 2 passing.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(gate\) tests/integration/gate-intake-action.test.ts
git commit -m "feat(gate): intake server action + form + supplier search

Phase 2 Task 12. Gate intake creates supplier (if new) + visit at
at_gate_in, then transitions to in_processing or in_receiving
based on entry_path. Form uses useActionState; SupplierSearch
hits the global suppliers table client-side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Gate home page — queue + recent intakes

**Files:**
- Modify: `src/app/(gate)/gate/page.tsx` (replace Phase 1 placeholder if any; create otherwise)

- [ ] **Step 1: Write the page**

```tsx
// src/app/(gate)/gate/page.tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";
import { getProfile } from "@/lib/auth/get-profile";

export default async function GateHomePage() {
  const me = await getProfile();
  const supabase = await createClient();

  const awaiting = await listVisitsByState(["awaiting_gate_exit"]);

  const { data: recent } = await supabase
    .from("visits")
    .select(`id, created_at, state, vehicle_plate,
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .eq("created_by", me?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gate</h1>
        <Link href="/gate/intake" className="px-4 py-2 bg-black text-white rounded">+ New visit intake</Link>
      </header>

      <section>
        <h2 className="font-semibold mb-2">Awaiting release ({awaiting.length})</h2>
        {awaiting.length === 0 ? (
          <p className="text-sm text-gray-600">No visits awaiting release.</p>
        ) : (
          <ul className="border rounded divide-y">
            {awaiting.map((v) => (
              <li key={v.id}>
                <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                  <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                  <div className="text-sm text-gray-600">
                    {v.declared_material_type?.name ?? "—"} · {v.vehicle_plate ?? "no plate"} · {formatTimestamp(v.created_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">My recent intakes</h2>
        {(!recent || recent.length === 0) ? (
          <p className="text-sm text-gray-600">No recent intakes.</p>
        ) : (
          <ul className="border rounded divide-y">
            {recent.map((v) => {
              const supplier = v.supplier as unknown as { name?: string; phone?: string | null } | null;
              const mat = v.declared_material_type as unknown as { name?: string } | null;
              return (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                    <div className="font-medium">{supplier?.name ?? "—"}</div>
                    <div className="text-sm text-gray-600">
                      {mat?.name ?? "—"} · {v.vehicle_plate ?? "no plate"} · {v.state} · {formatTimestamp(v.created_at)}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(gate\)/gate/page.tsx
git commit -m "feat(gate): home page with awaiting-release queue + my-recent intakes

Phase 2 Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Processing — server action, home page, ProcessingCard form

**Files:**
- Create: `src/app/(processing)/processing/page.tsx`
- Create: `src/app/(processing)/processing/actions.ts`
- Create: `src/components/visits/ProcessingCard.tsx`

- [ ] **Step 1: Write the server action**

```typescript
// src/app/(processing)/processing/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type ProcessingState = { error?: string };

type UsageLine = { machine_id: string; measurement: number };

export async function submitProcessing(
  _prev: ProcessingState,
  formData: FormData,
): Promise<ProcessingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const lines: UsageLine[] = [];
  for (const [key, val] of formData.entries()) {
    const m = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (!m) continue;
    const idx = Number(m[1]);
    lines[idx] ??= { machine_id: "", measurement: 0 };
    if (m[2] === "machine_id") lines[idx].machine_id = String(val);
    else lines[idx].measurement = Number(val);
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);
  if (cleaned.length === 0) return { error: "At least one machine usage row is required" };

  const supabase = await createClient();

  // Snapshot rates
  const { data: machineRows, error: mErr } = await supabase
    .from("machines")
    .select("id, rate")
    .in("id", cleaned.map((l) => l.machine_id));
  if (mErr) return { error: mErr.message };
  const rates = new Map<string, number>((machineRows ?? []).map((r) => [r.id as string, Number(r.rate)]));

  // Insert processing_records (RLS requires visit state = in_processing)
  const { data: rec, error: prErr } = await supabase
    .from("processing_records")
    .insert({ visit_id: visitId, recorded_by: me.id, started_at: new Date().toISOString(), completed_at: new Date().toISOString() })
    .select("id")
    .single();
  if (prErr || !rec) return { error: prErr?.message ?? "Failed to create processing record" };

  const usageRows = cleaned.map((l) => ({
    processing_record_id: rec.id,
    machine_id: l.machine_id,
    measurement: l.measurement,
    rate_snapshot: rates.get(l.machine_id) ?? 0,
  }));
  const { error: uErr } = await supabase.from("processing_machine_usage").insert(usageRows);
  if (uErr) return { error: uErr.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/processing");
  return {};
}

export async function updateProcessing(
  _prev: ProcessingState,
  formData: FormData,
): Promise<ProcessingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const recordId = String(formData.get("record_id") ?? "");
  if (!recordId) return { error: "Missing record id" };

  const lines: UsageLine[] = [];
  for (const [key, val] of formData.entries()) {
    const m = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (!m) continue;
    const idx = Number(m[1]);
    lines[idx] ??= { machine_id: "", measurement: 0 };
    if (m[2] === "machine_id") lines[idx].machine_id = String(val);
    else lines[idx].measurement = Number(val);
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);

  const supabase = await createClient();

  // Replace child rows: delete + reinsert
  const { error: delErr } = await supabase
    .from("processing_machine_usage")
    .delete()
    .eq("processing_record_id", recordId);
  if (delErr) return { error: delErr.message };

  if (cleaned.length > 0) {
    const { data: machineRows } = await supabase
      .from("machines").select("id, rate").in("id", cleaned.map((l) => l.machine_id));
    const rates = new Map<string, number>((machineRows ?? []).map((r) => [r.id as string, Number(r.rate)]));
    const rows = cleaned.map((l) => ({
      processing_record_id: recordId,
      machine_id: l.machine_id,
      measurement: l.measurement,
      rate_snapshot: rates.get(l.machine_id) ?? 0,
    }));
    await supabase.from("processing_machine_usage").insert(rows);
  }

  // Touch the parent so updated_at + record_edited fire
  await supabase.from("processing_records").update({ recorded_by: me.id }).eq("id", recordId);

  return {};
}
```

- [ ] **Step 2: Write the ProcessingCard component**

```tsx
// src/components/visits/ProcessingCard.tsx
"use client";

import { useActionState, useState } from "react";
import { submitProcessing, type ProcessingState } from "@/app/(processing)/processing/actions";

type Machine = { id: string; name: string; charge_basis: "weight" | "bag" | "hour"; rate: number };
type UsageDraft = { machine_id: string; measurement: string };

const initial: ProcessingState = {};

export function ProcessingCard({
  visitId,
  machines,
}: {
  visitId: string;
  machines: Machine[];
}) {
  const [state, action, pending] = useActionState(submitProcessing, initial);
  const [lines, setLines] = useState<UsageDraft[]>([{ machine_id: "", measurement: "" }]);

  function update(i: number, key: keyof UsageDraft, val: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="visit_id" value={visitId} />
      <div className="space-y-2">
        {lines.map((line, i) => {
          const machine = machines.find((m) => m.id === line.machine_id);
          const cost = machine && line.measurement
            ? Number(line.measurement) * Number(machine.rate)
            : 0;
          return (
            <div key={i} className="flex gap-2 items-center">
              <select
                name={`usage[${i}][machine_id]`}
                value={line.machine_id}
                onChange={(e) => update(i, "machine_id", e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="">— machine —</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} (₦{m.rate}/{m.charge_basis})</option>
                ))}
              </select>
              <input
                name={`usage[${i}][measurement]`}
                type="number" step="0.001" min="0"
                value={line.measurement}
                onChange={(e) => update(i, "measurement", e.target.value)}
                placeholder={machine ? machine.charge_basis : "amount"}
                className="border rounded px-2 py-1 w-32"
              />
              <span className="text-sm text-gray-600">= ₦{cost.toFixed(2)}</span>
              {lines.length > 1 && (
                <button type="button" className="text-sm underline"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                  Remove
                </button>
              )}
            </div>
          );
        })}
        <button type="button" className="text-sm underline"
          onClick={() => setLines((ls) => [...ls, { machine_id: "", measurement: "" }])}>
          + Add machine
        </button>
      </div>
      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}
      <button type="submit" disabled={pending} className="px-3 py-2 bg-black text-white rounded">
        {pending ? "Saving..." : "Submit processing"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the home page**

```tsx
// src/app/(processing)/processing/page.tsx
import Link from "next/link";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";

export default async function ProcessingHomePage() {
  const queue = await listVisitsByState(["in_processing"]);
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Processing — {queue.length} pending</h1>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-600">Queue is empty.</p>
      ) : (
        <ul className="border rounded divide-y">
          {queue.map((v) => (
            <li key={v.id}>
              <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                <div className="text-sm text-gray-600">
                  {v.declared_material_type?.name ?? "—"} · {v.vehicle_plate ?? "no plate"} · {formatTimestamp(v.created_at)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(processing\) src/components/visits/ProcessingCard.tsx
git commit -m "feat(processing): home queue + ProcessingCard form + server action

Phase 2 Task 14. Processing queue shows visits in in_processing.
Submit creates one processing_records row with N processing_machine_usage
rows (rate snapshotted from machines.rate). DB trigger transitions
visit to in_receiving.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Receiving — server action, home page, AnalysisCard form

**Files:**
- Create: `src/app/(receiving)/receiving/page.tsx`
- Create: `src/app/(receiving)/receiving/actions.ts`
- Create: `src/components/visits/AnalysisCard.tsx`

- [ ] **Step 1: Write the server action**

```typescript
// src/app/(receiving)/receiving/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type AnalysisState = { error?: string };

function parseXrfJson(raw: string): object | null {
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function submitAnalysis(_prev: AnalysisState, formData: FormData): Promise<AnalysisState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "receiving" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  const weight = Number(formData.get("weight"));
  if (!visitId) return { error: "Missing visit id" };
  if (!(weight >= 0)) return { error: "Weight is required and must be ≥ 0" };

  const sampleId = String(formData.get("sample_id") ?? "").trim() || null;
  const xrfRaw = String(formData.get("xrf_result") ?? "");
  const xrf = parseXrfJson(xrfRaw);
  if (xrfRaw.trim() && xrf === null) return { error: "XRF result must be valid JSON" };
  const purityRaw = String(formData.get("purity") ?? "").trim();
  const purity = purityRaw ? Number(purityRaw) : null;
  const grade = String(formData.get("grade") ?? "").trim() || null;
  const qc = String(formData.get("qc_observations") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("analysis_records").insert({
    visit_id: visitId,
    weight,
    sample_id: sampleId,
    xrf_result: xrf,
    purity,
    grade,
    qc_observations: qc,
    analyzed_at: new Date().toISOString(),
    recorded_by: me.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/receiving");
  return {};
}

export async function updateAnalysis(_prev: AnalysisState, formData: FormData): Promise<AnalysisState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "receiving" && me.role !== "owner") return { error: "Forbidden" };

  const recordId = String(formData.get("record_id") ?? "");
  if (!recordId) return { error: "Missing record id" };

  const patch: Record<string, unknown> = {};
  const weightRaw = formData.get("weight");
  if (weightRaw != null && String(weightRaw).trim() !== "") patch.weight = Number(weightRaw);
  const grade = formData.get("grade"); if (grade != null) patch.grade = String(grade).trim() || null;
  const purity = formData.get("purity"); if (purity != null && String(purity).trim() !== "") patch.purity = Number(purity);
  const sample = formData.get("sample_id"); if (sample != null) patch.sample_id = String(sample).trim() || null;
  const xrfRaw = String(formData.get("xrf_result") ?? "");
  if (xrfRaw.trim()) {
    const j = parseXrfJson(xrfRaw);
    if (j === null) return { error: "XRF result must be valid JSON" };
    patch.xrf_result = j;
  }
  const qc = formData.get("qc_observations"); if (qc != null) patch.qc_observations = String(qc).trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("analysis_records").update(patch).eq("id", recordId);
  if (error) return { error: error.message };
  return {};
}
```

- [ ] **Step 2: Write the AnalysisCard component**

```tsx
// src/components/visits/AnalysisCard.tsx
"use client";

import { useActionState } from "react";
import { submitAnalysis, type AnalysisState } from "@/app/(receiving)/receiving/actions";

const initial: AnalysisState = {};

export function AnalysisCard({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(submitAnalysis, initial);

  return (
    <form action={action} className="space-y-3 max-w-lg">
      <input type="hidden" name="visit_id" value={visitId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col text-sm">
          Weight (kg) *
          <input name="weight" type="number" step="0.001" min="0" required className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Sample ID
          <input name="sample_id" className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Grade
          <input name="grade" placeholder="e.g. B+" className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Purity (%)
          <input name="purity" type="number" step="0.01" min="0" max="100" className="border rounded px-2 py-1" />
        </label>
      </div>
      <label className="flex flex-col text-sm">
        XRF result (JSON)
        <textarea name="xrf_result" rows={3} placeholder='{"Sn": 58.2, "Fe": 12.1}' className="border rounded px-2 py-1 font-mono text-xs" />
      </label>
      <label className="flex flex-col text-sm">
        QC observations
        <textarea name="qc_observations" rows={2} className="border rounded px-2 py-1" />
      </label>
      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}
      <button type="submit" disabled={pending} className="px-3 py-2 bg-black text-white rounded">
        {pending ? "Saving..." : "Submit analysis"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the home page**

```tsx
// src/app/(receiving)/receiving/page.tsx
import Link from "next/link";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";

export default async function ReceivingHomePage() {
  const queue = await listVisitsByState(["in_receiving"]);
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Receiving — {queue.length} pending</h1>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-600">Queue is empty.</p>
      ) : (
        <ul className="border rounded divide-y">
          {queue.map((v) => (
            <li key={v.id}>
              <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                <div className="text-sm text-gray-600">
                  {v.declared_material_type?.name ?? "—"} · {v.entry_path} · {v.vehicle_plate ?? "no plate"} · {formatTimestamp(v.created_at)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(receiving\) src/components/visits/AnalysisCard.tsx
git commit -m "feat(receiving): home queue + AnalysisCard + server action

Phase 2 Task 15. Inserting analysis triggers state in_receiving → pricing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Manager — server action, home page, PricingCard form

**Files:**
- Create: `src/app/(manager)/manager/page.tsx`
- Create: `src/app/(manager)/manager/actions.ts`
- Create: `src/components/visits/PricingCard.tsx`

- [ ] **Step 1: Write the server action**

```typescript
// src/app/(manager)/manager/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type PricingState = { error?: string };

const TERMS = ["immediate", "deferred", "installment", "deducted"] as const;
const STATUSES = ["pending", "agreed", "not_agreed"] as const;

export async function submitPricing(_prev: PricingState, formData: FormData): Promise<PricingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "manager" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  const recordId = String(formData.get("record_id") ?? "");
  if (!visitId && !recordId) return { error: "Missing visit/record id" };

  const status = String(formData.get("agreement_status") ?? "pending");
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { error: "Invalid agreement status" };
  }
  const unitPriceRaw = String(formData.get("unit_price") ?? "").trim();
  const unitPrice = unitPriceRaw ? Number(unitPriceRaw) : null;
  const terms = String(formData.get("payment_terms") ?? "").trim() || null;
  if (terms && !TERMS.includes(terms as (typeof TERMS)[number])) {
    return { error: "Invalid payment terms" };
  }

  if (status === "agreed") {
    if (unitPrice == null || !(unitPrice >= 0)) return { error: "Unit price is required for an agreed deal" };
    if (!terms) return { error: "Payment terms are required for an agreed deal" };
  }

  const supabase = await createClient();

  if (recordId) {
    const patch: Record<string, unknown> = {
      agreement_status: status,
      unit_price: unitPrice,
      payment_terms: terms,
    };
    if (me.role === "owner") patch.overridden_by = me.id;
    const { error } = await supabase.from("pricing").update(patch).eq("id", recordId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("pricing").insert({
      visit_id: visitId,
      unit_price: unitPrice,
      agreement_status: status,
      payment_terms: terms,
      priced_by: me.id,
    });
    if (error) return { error: error.message };
  }

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/manager");
  return {};
}
```

- [ ] **Step 2: Write the PricingCard component**

```tsx
// src/components/visits/PricingCard.tsx
"use client";

import { useActionState, useState } from "react";
import { submitPricing, type PricingState } from "@/app/(manager)/manager/actions";
import { formatNaira, formatWeight } from "@/lib/visits/format";

type ExistingPricing = {
  id: string;
  unit_price: number | null;
  agreement_status: "pending" | "agreed" | "not_agreed";
  payment_terms: "immediate" | "deferred" | "installment" | "deducted" | null;
};

const initial: PricingState = {};

export function PricingCard({
  visitId,
  analysisWeight,
  existing,
}: {
  visitId: string;
  analysisWeight: number;
  existing?: ExistingPricing | null;
}) {
  const [state, action, pending] = useActionState(submitPricing, initial);
  const [unitPrice, setUnitPrice] = useState<string>(existing?.unit_price?.toString() ?? "");
  const [status, setStatus] = useState(existing?.agreement_status ?? "pending");
  const [terms, setTerms] = useState(existing?.payment_terms ?? "");

  const purchaseAmount = unitPrice ? Number(unitPrice) * analysisWeight : null;

  return (
    <form action={action} className="space-y-3 max-w-lg">
      <input type="hidden" name="visit_id" value={visitId} />
      {existing && <input type="hidden" name="record_id" value={existing.id} />}

      <div className="text-sm text-gray-600">Analysis weight: {formatWeight(analysisWeight)}</div>

      <label className="flex flex-col text-sm">
        Unit price (₦ per kg)
        <input
          name="unit_price"
          type="number"
          step="0.01"
          min="0"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </label>

      <div className="text-sm">Purchase amount: <strong>{formatNaira(purchaseAmount)}</strong></div>

      <fieldset className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="agreement_status" value="pending" checked={status === "pending"} onChange={() => setStatus("pending")} /> Pending
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="agreement_status" value="agreed" checked={status === "agreed"} onChange={() => setStatus("agreed")} /> Agreed
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="agreement_status" value="not_agreed" checked={status === "not_agreed"} onChange={() => setStatus("not_agreed")} /> No agreement
        </label>
      </fieldset>

      {status === "agreed" && (
        <label className="flex flex-col text-sm">
          Payment terms *
          <select
            name="payment_terms"
            value={terms ?? ""}
            onChange={(e) => setTerms(e.target.value as typeof terms)}
            required
            className="border rounded px-2 py-1"
          >
            <option value="">— select —</option>
            <option value="immediate">Immediate</option>
            <option value="deferred">Deferred (pay later)</option>
            <option value="installment">Installments</option>
            <option value="deducted">Deduct from processing fee</option>
          </select>
        </label>
      )}

      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}

      <button type="submit" disabled={pending} className="px-3 py-2 bg-black text-white rounded">
        {pending ? "Saving..." : existing ? "Update pricing" : "Submit pricing"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the home page**

```tsx
// src/app/(manager)/manager/page.tsx
import Link from "next/link";
import { listVisitsByStateWithAnalysis } from "@/lib/visits/queries";
import { formatTimestamp, formatWeight } from "@/lib/visits/format";

export default async function ManagerHomePage() {
  const queue = await listVisitsByStateWithAnalysis("pricing");
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Manager — {queue.length} pending</h1>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-600">Queue is empty.</p>
      ) : (
        <ul className="border rounded divide-y">
          {queue.map((v) => (
            <li key={v.id}>
              <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                    <div className="text-sm text-gray-600">
                      {v.declared_material_type?.name ?? "—"} · {formatTimestamp(v.created_at)}
                    </div>
                  </div>
                  <div className="text-sm text-right">
                    <div>Grade: <strong>{v.analysis?.grade ?? "—"}</strong></div>
                    <div>{v.analysis ? formatWeight(v.analysis.weight) : "—"}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(manager\) src/components/visits/PricingCard.tsx
git commit -m "feat(manager): home queue + PricingCard + server action

Phase 2 Task 16. Manager picks unit price + agreement decision.
Agreed status requires unit_price + payment_terms (enforced both
in the action and by CHECK constraints in the DB). Submission
triggers visit transition to in_accounting or awaiting_gate_exit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Owner authorize-exit action + extend Owner home

**Files:**
- Modify (or create): `src/app/(owner)/owner/actions.ts`
- Modify: `src/app/(owner)/owner/page.tsx`

- [ ] **Step 1: Add authorize-exit action**

```typescript
// src/app/(owner)/owner/actions.ts  (extend Phase 1 file, or create new)
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type AuthorizeState = { error?: string };

export async function authorizeExit(
  _prev: AuthorizeState,
  formData: FormData,
): Promise<AuthorizeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "owner") return { error: "Only owner can authorize" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };
  const note = String(formData.get("note") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("gate_exit_authorizations").insert({
    visit_id: visitId, authorized_by: me.id, note,
  });
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner");
  return {};
}
```

- [ ] **Step 2: Extend Owner home with cross-site awaiting-exit board + nav**

```tsx
// src/app/(owner)/owner/page.tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTimestamp } from "@/lib/visits/format";

export default async function OwnerHomePage() {
  const supabase = await createClient();
  const { data: awaiting } = await supabase
    .from("visits")
    .select(`id, created_at, state, vehicle_plate, site:sites(name),
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .eq("state", "awaiting_gate_exit")
    .order("created_at", { ascending: true });

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Owner — cross-site overview</h1>
      </header>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link href="/owner/employees" className="px-3 py-2 border rounded">Employees</Link>
        <Link href="/owner/material-types" className="px-3 py-2 border rounded">Material types</Link>
        <Link href="/owner/machines" className="px-3 py-2 border rounded">Machines</Link>
        <Link href="/owner/visits" className="px-3 py-2 border rounded">All visits</Link>
      </nav>

      <section>
        <h2 className="font-semibold mb-2">
          Awaiting your sign-off ({awaiting?.length ?? 0})
        </h2>
        {(!awaiting || awaiting.length === 0) ? (
          <p className="text-sm text-gray-600">No visits awaiting authorization.</p>
        ) : (
          <ul className="border rounded divide-y">
            {awaiting.map((v) => {
              const sup = v.supplier as unknown as { name?: string; phone?: string | null } | null;
              const mat = v.declared_material_type as unknown as { name?: string } | null;
              const site = v.site as unknown as { name?: string } | null;
              return (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-medium">{sup?.name ?? "—"}</div>
                        <div className="text-sm text-gray-600">
                          {site?.name ?? "—"} · {mat?.name ?? "—"} · {v.vehicle_plate ?? "no plate"}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">{formatTimestamp(v.created_at)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(owner\)/owner/actions.ts src/app/\(owner\)/owner/page.tsx
git commit -m "feat(owner): authorize-exit action + cross-site awaiting-exit board

Phase 2 Task 17. authorizeExit inserts a gate_exit_authorizations
row (trigger writes the audit event). Owner home gains a nav with
links to Employees / Material types / Machines / All visits, plus
the cross-site list of visits awaiting owner sign-off.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Shared visit detail page + stage cards + audit trail

**Files:**
- Create: `src/app/visits/[id]/page.tsx`
- Create: `src/components/visits/VisitTimeline.tsx`
- Create: `src/components/visits/GateIntakeCard.tsx`
- Create: `src/components/visits/ExitAuthorizationCard.tsx`
- Create: `src/components/visits/AuditTrail.tsx`

- [ ] **Step 1: Write GateIntakeCard**

```tsx
// src/components/visits/GateIntakeCard.tsx
import { formatTimestamp } from "@/lib/visits/format";

export function GateIntakeCard({
  supplier, material, vehiclePlate, entryPath, createdAt, createdByName,
}: {
  supplier: { name: string; phone: string | null } | null;
  material: { name: string } | null;
  vehiclePlate: string | null;
  entryPath: "unprocessed" | "pre_processed";
  createdAt: string;
  createdByName: string | null;
}) {
  return (
    <section className="border rounded p-4">
      <div className="text-xs uppercase text-gray-500 mb-1">Gate intake</div>
      <div className="font-medium">{supplier?.name ?? "—"}</div>
      <div className="text-sm text-gray-600">{supplier?.phone ?? "—"}</div>
      <div className="text-sm mt-2">
        Vehicle: {vehiclePlate ?? "—"} · Declared: {material?.name ?? "—"} · Path: {entryPath}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        Recorded by {createdByName ?? "—"} at {formatTimestamp(createdAt)}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write ExitAuthorizationCard**

```tsx
// src/components/visits/ExitAuthorizationCard.tsx
"use client";

import { useActionState } from "react";
import { authorizeExit, type AuthorizeState } from "@/app/(owner)/owner/actions";
import { releaseVisit, type IntakeState } from "@/app/(gate)/gate/actions";
import { formatTimestamp } from "@/lib/visits/format";

type Authorization = { authorized_at: string; authorized_by_name: string | null; note: string | null };

const initialAuthorize: AuthorizeState = {};

export function ExitAuthorizationCard({
  visitId,
  authorization,
  canAuthorize,
  canRelease,
}: {
  visitId: string;
  authorization: Authorization | null;
  canAuthorize: boolean;
  canRelease: boolean;
}) {
  const [authState, authAction, authPending] = useActionState(authorizeExit, initialAuthorize);

  async function handleRelease() {
    const result = await releaseVisit(visitId) as IntakeState;
    if (result.error) alert(result.error);
    else window.location.reload();
  }

  return (
    <section className="border rounded p-4">
      <div className="text-xs uppercase text-gray-500 mb-1">Exit authorization</div>

      {authorization ? (
        <>
          <div className="text-sm">
            Authorized by {authorization.authorized_by_name ?? "—"} at {formatTimestamp(authorization.authorized_at)}
          </div>
          {authorization.note && <div className="text-sm text-gray-600 mt-1">“{authorization.note}”</div>}
          {canRelease && (
            <button onClick={handleRelease} className="mt-3 px-3 py-2 bg-black text-white rounded">
              Release supplier
            </button>
          )}
        </>
      ) : canAuthorize ? (
        <form action={authAction} className="space-y-2 mt-2">
          <input type="hidden" name="visit_id" value={visitId} />
          <input name="note" placeholder="Optional note" className="w-full border rounded px-2 py-1" />
          {authState.error && <p className="text-red-600 text-sm">{authState.error}</p>}
          <button type="submit" disabled={authPending} className="px-3 py-2 bg-black text-white rounded">
            {authPending ? "Authorizing..." : "Authorize exit"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-600">Waiting for owner to authorize.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write AuditTrail**

```tsx
// src/components/visits/AuditTrail.tsx
import { formatTimestamp } from "@/lib/visits/format";

type Event = {
  id: string;
  event_type: string;
  created_at: string;
  actor_name: string | null;
  payload: Record<string, unknown>;
};

function describe(e: Event): string {
  switch (e.event_type) {
    case "visit_created": return "Visit created";
    case "state_changed":
      return `State: ${(e.payload as { from?: string }).from ?? "?"} → ${(e.payload as { to?: string }).to ?? "?"}`;
    case "record_created":
      return `Record created on ${(e.payload as { table?: string }).table ?? "?"}`;
    case "record_edited":
      return `Record edited on ${(e.payload as { table?: string }).table ?? "?"}`;
    case "gate_exit_authorized": return "Gate exit authorized";
    case "gate_released": return "Released through gate";
    case "owner_override": return "Owner override";
    default: return e.event_type;
  }
}

export function AuditTrail({ events }: { events: Event[] }) {
  return (
    <details className="border rounded p-3">
      <summary className="cursor-pointer text-sm font-medium">Audit trail ({events.length})</summary>
      <ul className="mt-3 space-y-2 text-sm">
        {events.map((e) => (
          <li key={e.id} className="border-l-2 border-gray-200 pl-3">
            <div className="font-medium">{describe(e)}</div>
            <div className="text-xs text-gray-500">
              {e.actor_name ?? "—"} · {formatTimestamp(e.created_at)}
            </div>
            {e.event_type === "record_edited" && (
              <pre className="text-xs bg-gray-50 p-2 mt-1 rounded overflow-x-auto">
                {JSON.stringify((e.payload as { diff?: unknown }).diff ?? {}, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 4: Write VisitTimeline**

```tsx
// src/components/visits/VisitTimeline.tsx
import { GateIntakeCard } from "./GateIntakeCard";
import { ProcessingCard } from "./ProcessingCard";
import { AnalysisCard } from "./AnalysisCard";
import { PricingCard } from "./PricingCard";
import { ExitAuthorizationCard } from "./ExitAuthorizationCard";
import { AuditTrail } from "./AuditTrail";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";
import { formatNaira, formatTimestamp, formatWeight } from "@/lib/visits/format";

type Machine = { id: string; name: string; charge_basis: "weight" | "bag" | "hour"; rate: number };

export type VisitTimelineProps = {
  visit: {
    id: string;
    state: VisitState;
    entry_path: "unprocessed" | "pre_processed";
    vehicle_plate: string | null;
    created_at: string;
    closed_at: string | null;
    site: { name: string } | null;
    supplier: { name: string; phone: string | null } | null;
    declared_material_type: { name: string } | null;
    created_by_name: string | null;
  };
  processing: {
    id: string;
    recorded_by_name: string | null;
    completed_at: string | null;
    usage: { machine_name: string; charge_basis: string; measurement: number; rate_snapshot: number; line_cost: number }[];
  } | null;
  analysis: {
    id: string;
    weight: number;
    grade: string | null;
    purity: number | null;
    sample_id: string | null;
    qc_observations: string | null;
    xrf_result: unknown;
    recorded_by_name: string | null;
    analyzed_at: string | null;
  } | null;
  pricing: {
    id: string;
    unit_price: number | null;
    purchase_amount: number | null;
    agreement_status: "pending" | "agreed" | "not_agreed";
    payment_terms: "immediate" | "deferred" | "installment" | "deducted" | null;
    priced_by_name: string | null;
    overridden_by_name: string | null;
  } | null;
  authorization: {
    authorized_at: string;
    authorized_by_name: string | null;
    note: string | null;
  } | null;
  events: Parameters<typeof AuditTrail>[0]["events"];
  viewer: { role: "gate" | "processing" | "receiving" | "manager" | "accounting" | "inventory" | "owner" };
  machines: Machine[];
};

export function VisitTimeline(props: VisitTimelineProps) {
  const { visit, processing, analysis, pricing, authorization, events, viewer, machines } = props;
  const isOpen = visit.state !== "exited" && visit.state !== "stocked";
  const isOwner = viewer.role === "owner";

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-4">
      <header className="border rounded p-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-semibold">Visit {visit.id.slice(0, 8)}</h1>
            <div className="text-sm text-gray-600">
              {visit.site?.name ?? "—"} · {visit.supplier?.name ?? "—"} · {visit.declared_material_type?.name ?? "—"}
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block px-2 py-1 text-xs rounded bg-gray-100">{STATE_LABELS[visit.state]}</span>
            <div className="text-xs text-gray-500 mt-1">Opened {formatTimestamp(visit.created_at)}</div>
            {visit.closed_at && <div className="text-xs text-gray-500">Closed {formatTimestamp(visit.closed_at)}</div>}
          </div>
        </div>
      </header>

      <GateIntakeCard
        supplier={visit.supplier}
        material={visit.declared_material_type}
        vehiclePlate={visit.vehicle_plate}
        entryPath={visit.entry_path}
        createdAt={visit.created_at}
        createdByName={visit.created_by_name}
      />

      {visit.entry_path === "unprocessed" && (
        <section className="border rounded p-4">
          <div className="text-xs uppercase text-gray-500 mb-1">Processing</div>
          {processing ? (
            <>
              <ul className="text-sm">
                {processing.usage.map((u, i) => (
                  <li key={i}>
                    {u.machine_name}: {u.measurement} {u.charge_basis} × {formatNaira(u.rate_snapshot)} = {formatNaira(u.line_cost)}
                  </li>
                ))}
              </ul>
              <div className="text-sm mt-2">
                Total fee: <strong>{formatNaira(processing.usage.reduce((s, u) => s + Number(u.line_cost), 0))}</strong>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {processing.recorded_by_name ?? "—"} · {formatTimestamp(processing.completed_at)}
              </div>
            </>
          ) : visit.state === "in_processing" && (viewer.role === "processing" || isOwner) ? (
            <ProcessingCard visitId={visit.id} machines={machines} />
          ) : (
            <p className="text-sm text-gray-600">Pending processing.</p>
          )}
        </section>
      )}

      <section className="border rounded p-4">
        <div className="text-xs uppercase text-gray-500 mb-1">Analysis</div>
        {analysis ? (
          <>
            <div className="text-sm">
              Weight: <strong>{formatWeight(analysis.weight)}</strong>{" "}
              · Grade: <strong>{analysis.grade ?? "—"}</strong>
              {analysis.purity != null && <> · Purity: <strong>{analysis.purity}%</strong></>}
            </div>
            {analysis.sample_id && <div className="text-sm text-gray-600">Sample: {analysis.sample_id}</div>}
            {analysis.qc_observations && <div className="text-sm text-gray-600 mt-1">{analysis.qc_observations}</div>}
            {analysis.xrf_result ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">View raw XRF</summary>
                <pre className="bg-gray-50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(analysis.xrf_result, null, 2)}</pre>
              </details>
            ) : null}
            <div className="text-xs text-gray-500 mt-2">
              {analysis.recorded_by_name ?? "—"} · {formatTimestamp(analysis.analyzed_at)}
            </div>
          </>
        ) : visit.state === "in_receiving" && (viewer.role === "receiving" || isOwner) ? (
          <AnalysisCard visitId={visit.id} />
        ) : (
          <p className="text-sm text-gray-600">Pending analysis.</p>
        )}
      </section>

      <section className="border rounded p-4">
        <div className="text-xs uppercase text-gray-500 mb-1">Pricing</div>
        {pricing && pricing.agreement_status !== "pending" ? (
          <div className="text-sm">
            Unit price: <strong>{formatNaira(pricing.unit_price)}</strong>{" "}
            · Total: <strong>{formatNaira(pricing.purchase_amount)}</strong>
            <div className="mt-1">
              Status: <strong>{pricing.agreement_status}</strong>
              {pricing.payment_terms && <> · Terms: <strong>{pricing.payment_terms}</strong></>}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Priced by {pricing.priced_by_name ?? "—"}
              {pricing.overridden_by_name && <> · Overridden by {pricing.overridden_by_name}</>}
            </div>
          </div>
        ) : visit.state === "pricing" && (viewer.role === "manager" || isOwner) && analysis ? (
          <PricingCard
            visitId={visit.id}
            analysisWeight={analysis.weight}
            existing={pricing ? {
              id: pricing.id,
              unit_price: pricing.unit_price,
              agreement_status: pricing.agreement_status,
              payment_terms: pricing.payment_terms,
            } : null}
          />
        ) : (
          <p className="text-sm text-gray-600">Pending pricing.</p>
        )}
      </section>

      {visit.state === "awaiting_gate_exit" || authorization ? (
        <ExitAuthorizationCard
          visitId={visit.id}
          authorization={authorization}
          canAuthorize={isOwner && !authorization && visit.state === "awaiting_gate_exit"}
          canRelease={(viewer.role === "gate" || isOwner) && !!authorization && visit.state === "awaiting_gate_exit"}
        />
      ) : null}

      <AuditTrail events={events} />
    </main>
  );
}
```

- [ ] **Step 5: Write the visit detail page**

```tsx
// src/app/visits/[id]/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { VisitTimeline } from "@/components/visits/VisitTimeline";
import type { VisitState } from "@/lib/visits/state-machine";

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getProfile();
  if (!me) notFound();
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select(`
      id, state, entry_path, vehicle_plate, created_at, closed_at,
      site:sites(name),
      supplier:suppliers(name, phone),
      declared_material_type:material_types(name),
      created_by_profile:profiles!visits_created_by_fkey(full_name)
    `)
    .eq("id", id)
    .single();
  if (!visit) notFound();

  const { data: pr } = await supabase
    .from("processing_records")
    .select(`
      id, completed_at,
      recorded_by_profile:profiles!processing_records_recorded_by_fkey(full_name),
      usage:processing_machine_usage(
        measurement, rate_snapshot, line_cost,
        machine:machines(name, charge_basis)
      )
    `)
    .eq("visit_id", id)
    .maybeSingle();

  const { data: an } = await supabase
    .from("analysis_records")
    .select(`
      id, weight, grade, purity, sample_id, qc_observations, xrf_result, analyzed_at,
      recorded_by_profile:profiles!analysis_records_recorded_by_fkey(full_name)
    `)
    .eq("visit_id", id)
    .maybeSingle();

  const { data: pricing } = await supabase
    .from("pricing")
    .select(`
      id, unit_price, purchase_amount, agreement_status, payment_terms,
      priced_by_profile:profiles!pricing_priced_by_fkey(full_name),
      overridden_by_profile:profiles!pricing_overridden_by_fkey(full_name)
    `)
    .eq("visit_id", id)
    .maybeSingle();

  const { data: auth } = await supabase
    .from("gate_exit_authorizations")
    .select(`
      authorized_at, note,
      authorized_by_profile:profiles!gate_exit_authorizations_authorized_by_fkey(full_name)
    `)
    .eq("visit_id", id)
    .maybeSingle();

  const { data: events } = await supabase
    .from("transaction_events")
    .select(`
      id, event_type, created_at, payload,
      actor:profiles!transaction_events_actor_id_fkey(full_name)
    `)
    .eq("visit_id", id)
    .order("created_at", { ascending: true });

  const { data: machines } = (visit as { site_id?: string }).site_id
    ? await supabase.from("machines").select("id, name, charge_basis, rate").eq("active", true)
    : { data: [] as { id: string; name: string; charge_basis: "weight" | "bag" | "hour"; rate: number }[] };

  // Untangle Supabase array-relation shapes
  const get1 = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const visitNorm = {
    id: visit.id as string,
    state: visit.state as VisitState,
    entry_path: visit.entry_path as "unprocessed" | "pre_processed",
    vehicle_plate: visit.vehicle_plate as string | null,
    created_at: visit.created_at as string,
    closed_at: visit.closed_at as string | null,
    site: get1((visit as { site: unknown }).site) as { name: string } | null,
    supplier: get1((visit as { supplier: unknown }).supplier) as { name: string; phone: string | null } | null,
    declared_material_type: get1((visit as { declared_material_type: unknown }).declared_material_type) as { name: string } | null,
    created_by_name: (get1((visit as { created_by_profile: unknown }).created_by_profile) as { full_name?: string } | null)?.full_name ?? null,
  };

  const processingNorm = pr ? {
    id: pr.id as string,
    recorded_by_name: (get1((pr as { recorded_by_profile: unknown }).recorded_by_profile) as { full_name?: string } | null)?.full_name ?? null,
    completed_at: pr.completed_at as string | null,
    usage: ((pr as { usage: unknown[] }).usage ?? []).map((u) => {
      const r = u as {
        machine: { name: string; charge_basis: string } | { name: string; charge_basis: string }[] | null;
        measurement: number; rate_snapshot: number; line_cost: number;
      };
      const m = get1(r.machine) ?? { name: "—", charge_basis: "—" };
      return {
        machine_name: m.name,
        charge_basis: m.charge_basis,
        measurement: Number(r.measurement),
        rate_snapshot: Number(r.rate_snapshot),
        line_cost: Number(r.line_cost),
      };
    }),
  } : null;

  const analysisNorm = an ? {
    id: an.id as string,
    weight: Number(an.weight),
    grade: an.grade as string | null,
    purity: an.purity != null ? Number(an.purity) : null,
    sample_id: an.sample_id as string | null,
    qc_observations: an.qc_observations as string | null,
    xrf_result: an.xrf_result,
    recorded_by_name: (get1((an as { recorded_by_profile: unknown }).recorded_by_profile) as { full_name?: string } | null)?.full_name ?? null,
    analyzed_at: an.analyzed_at as string | null,
  } : null;

  const pricingNorm = pricing ? {
    id: pricing.id as string,
    unit_price: pricing.unit_price != null ? Number(pricing.unit_price) : null,
    purchase_amount: pricing.purchase_amount != null ? Number(pricing.purchase_amount) : null,
    agreement_status: pricing.agreement_status as "pending" | "agreed" | "not_agreed",
    payment_terms: pricing.payment_terms as "immediate" | "deferred" | "installment" | "deducted" | null,
    priced_by_name: (get1((pricing as { priced_by_profile: unknown }).priced_by_profile) as { full_name?: string } | null)?.full_name ?? null,
    overridden_by_name: (get1((pricing as { overridden_by_profile: unknown }).overridden_by_profile) as { full_name?: string } | null)?.full_name ?? null,
  } : null;

  const authorizationNorm = auth ? {
    authorized_at: auth.authorized_at as string,
    note: auth.note as string | null,
    authorized_by_name: (get1((auth as { authorized_by_profile: unknown }).authorized_by_profile) as { full_name?: string } | null)?.full_name ?? null,
  } : null;

  const eventsNorm = (events ?? []).map((e) => ({
    id: e.id as string,
    event_type: e.event_type as string,
    created_at: e.created_at as string,
    actor_name: (get1((e as { actor: unknown }).actor) as { full_name?: string } | null)?.full_name ?? null,
    payload: (e.payload ?? {}) as Record<string, unknown>,
  }));

  return (
    <VisitTimeline
      visit={visitNorm}
      processing={processingNorm}
      analysis={analysisNorm}
      pricing={pricingNorm}
      authorization={authorizationNorm}
      events={eventsNorm}
      viewer={{ role: me.role }}
      machines={(machines ?? []) as { id: string; name: string; charge_basis: "weight" | "bag" | "hour"; rate: number }[]}
    />
  );
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add src/app/visits src/components/visits/VisitTimeline.tsx src/components/visits/GateIntakeCard.tsx src/components/visits/ExitAuthorizationCard.tsx src/components/visits/AuditTrail.tsx
git commit -m "feat(visits): shared visit detail page with stage cards + audit trail

Phase 2 Task 18. /visits/[id] is the source of truth for what a visit
looks like. Every role gets the same timeline (RLS scopes their site);
action buttons render only when the viewer's role × visit state
matches. Audit trail renders the transaction_events log.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Owner — material-types CRUD

**Files:**
- Create: `src/app/(owner)/owner/material-types/page.tsx`
- Create: `src/app/(owner)/owner/material-types/actions.ts`

- [ ] **Step 1: Write the actions**

```typescript
// src/app/(owner)/owner/material-types/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type MtState = { error?: string };

export async function createMaterialType(_prev: MtState, formData: FormData): Promise<MtState> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Forbidden" };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required" };
  const supabase = await createClient();
  const { error } = await supabase.from("material_types").insert({ name, created_by: me.id });
  if (error) return { error: error.message };
  revalidatePath("/owner/material-types");
  return {};
}

export async function toggleMaterialType(_prev: MtState, formData: FormData): Promise<MtState> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Forbidden" };
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("material_types").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/owner/material-types");
  return {};
}
```

- [ ] **Step 2: Write the page**

```tsx
// src/app/(owner)/owner/material-types/page.tsx
import { createClient } from "@/lib/supabase/server";
import { createMaterialType, toggleMaterialType } from "./actions";

export default async function MaterialTypesPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("material_types").select("id, name, active").order("name");

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Material types</h1>

      <form action={createMaterialType} className="flex gap-2">
        <input name="name" required placeholder="New material name" className="flex-1 border rounded px-3 py-2" />
        <button type="submit" className="px-3 py-2 bg-black text-white rounded">Add</button>
      </form>

      <ul className="border rounded divide-y">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between px-3 py-2">
            <span className={r.active ? "" : "text-gray-400 line-through"}>{r.name}</span>
            <form action={toggleMaterialType}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="active" value={r.active ? "false" : "true"} />
              <button type="submit" className="text-sm underline">
                {r.active ? "Disable" : "Enable"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Verify build + commit**

```bash
npm run build 2>&1 | tail -5
git add src/app/\(owner\)/owner/material-types
git commit -m "feat(owner): material-types CRUD page

Phase 2 Task 19. Owner can add and soft-delete material types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Owner — machines CRUD

**Files:**
- Create: `src/app/(owner)/owner/machines/page.tsx`
- Create: `src/app/(owner)/owner/machines/actions.ts`

- [ ] **Step 1: Write the actions**

```typescript
// src/app/(owner)/owner/machines/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type MachineState = { error?: string };

const BASES = ["weight", "bag", "hour"] as const;

export async function createMachine(_prev: MachineState, formData: FormData): Promise<MachineState> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Forbidden" };
  const site_id = String(formData.get("site_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const charge_basis = String(formData.get("charge_basis") ?? "");
  const rate = Number(formData.get("rate"));
  if (!site_id || !name) return { error: "Site and name are required" };
  if (!BASES.includes(charge_basis as (typeof BASES)[number])) return { error: "Invalid charge basis" };
  if (!(rate >= 0)) return { error: "Rate must be ≥ 0" };
  const supabase = await createClient();
  const { error } = await supabase.from("machines").insert({
    site_id, name, charge_basis, rate, created_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/owner/machines");
  return {};
}

export async function updateMachine(_prev: MachineState, formData: FormData): Promise<MachineState> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Forbidden" };
  const id = String(formData.get("id") ?? "");
  const patch: Record<string, unknown> = {};
  const rate = formData.get("rate");
  if (rate != null && String(rate).trim() !== "") patch.rate = Number(rate);
  const activeRaw = formData.get("active");
  if (activeRaw != null) patch.active = activeRaw === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("machines").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/owner/machines");
  return {};
}
```

- [ ] **Step 2: Write the page**

```tsx
// src/app/(owner)/owner/machines/page.tsx
import { createClient } from "@/lib/supabase/server";
import { createMachine, updateMachine } from "./actions";

export default async function MachinesPage() {
  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");
  const { data: machines } = await supabase
    .from("machines")
    .select("id, name, charge_basis, rate, active, site:sites(name)")
    .order("name");

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Machines</h1>

      <form action={createMachine} className="border rounded p-3 grid grid-cols-2 gap-2">
        <select name="site_id" required className="border rounded px-2 py-1">
          <option value="">— site —</option>
          {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input name="name" required placeholder="Machine name" className="border rounded px-2 py-1" />
        <select name="charge_basis" required className="border rounded px-2 py-1">
          <option value="weight">weight (kg)</option>
          <option value="bag">bag</option>
          <option value="hour">hour</option>
        </select>
        <input name="rate" type="number" step="0.01" min="0" required placeholder="₦ rate" className="border rounded px-2 py-1" />
        <button type="submit" className="col-span-2 px-3 py-2 bg-black text-white rounded">Add machine</button>
      </form>

      <table className="w-full border rounded text-sm">
        <thead className="bg-gray-50">
          <tr><th className="p-2 text-left">Site</th><th className="p-2 text-left">Name</th><th className="p-2 text-left">Basis</th><th className="p-2 text-right">Rate</th><th className="p-2"></th></tr>
        </thead>
        <tbody>
          {(machines ?? []).map((m) => {
            const site = m.site as unknown as { name?: string } | null;
            return (
              <tr key={m.id} className={`border-t ${m.active ? "" : "text-gray-400 line-through"}`}>
                <td className="p-2">{site?.name ?? "—"}</td>
                <td className="p-2">{m.name}</td>
                <td className="p-2">{m.charge_basis}</td>
                <td className="p-2 text-right">₦{m.rate}</td>
                <td className="p-2 text-right">
                  <form action={updateMachine}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                    <button type="submit" className="text-xs underline">{m.active ? "Disable" : "Enable"}</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Verify build + commit**

```bash
npm run build 2>&1 | tail -5
git add src/app/\(owner\)/owner/machines
git commit -m "feat(owner): machines CRUD page

Phase 2 Task 20. Owner can add machines (site, name, basis, rate)
and soft-delete via active=false. Rate edits do not retroactively
change processing fees because rate_snapshot is captured at the
time the processing record was created.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Owner — cross-site visits browser

**Files:**
- Create: `src/app/(owner)/owner/visits/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(owner)/owner/visits/page.tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { STATE_LABELS, VISIT_STATES, type VisitState } from "@/lib/visits/state-machine";
import { formatTimestamp } from "@/lib/visits/format";

type SP = { state?: string; site_id?: string };

export default async function OwnerVisitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");

  let q = supabase
    .from("visits")
    .select(`id, created_at, state, vehicle_plate,
             site:sites(name),
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (sp.state) q = q.eq("state", sp.state);
  if (sp.site_id) q = q.eq("site_id", sp.site_id);
  const { data: rows } = await q;

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">All visits</h1>

      <form className="flex gap-2 text-sm">
        <select name="state" defaultValue={sp.state ?? ""} className="border rounded px-2 py-1">
          <option value="">All states</option>
          {VISIT_STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s as VisitState]}</option>)}
        </select>
        <select name="site_id" defaultValue={sp.site_id ?? ""} className="border rounded px-2 py-1">
          <option value="">All sites</option>
          {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="submit" className="px-3 py-1 border rounded">Filter</button>
      </form>

      <table className="w-full border rounded text-sm">
        <thead className="bg-gray-50">
          <tr><th className="p-2 text-left">Site</th><th className="p-2 text-left">Supplier</th><th className="p-2 text-left">Material</th><th className="p-2 text-left">State</th><th className="p-2 text-left">Opened</th></tr>
        </thead>
        <tbody>
          {(rows ?? []).map((v) => {
            const site = v.site as unknown as { name?: string } | null;
            const sup = v.supplier as unknown as { name?: string } | null;
            const mat = v.declared_material_type as unknown as { name?: string } | null;
            return (
              <tr key={v.id} className="border-t">
                <td className="p-2">{site?.name ?? "—"}</td>
                <td className="p-2"><Link href={`/visits/${v.id}`} className="underline">{sup?.name ?? "—"}</Link></td>
                <td className="p-2">{mat?.name ?? "—"}</td>
                <td className="p-2">{STATE_LABELS[v.state as VisitState]}</td>
                <td className="p-2">{formatTimestamp(v.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Verify build + commit**

```bash
npm run build 2>&1 | tail -5
git add src/app/\(owner\)/owner/visits
git commit -m "feat(owner): cross-site visits browser with filters

Phase 2 Task 21. /owner/visits lists every visit across all sites
with state + site filters. Each row links to /visits/[id].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Integration test — happy path (unprocessed)

**Files:**
- Create: `tests/integration/happy-path-unprocessed.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/happy-path-unprocessed.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("happy path: unprocessed → agreed → in_accounting", () => {
  let siteId: string;
  let gate: TestUser, proc: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string, machineId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate  = await makeUser({ username: "hpu-gate",  role: "gate",       siteId });
    proc  = await makeUser({ username: "hpu-proc",  role: "processing", siteId });
    recv  = await makeUser({ username: "hpu-recv",  role: "receiving",  siteId });
    mgr   = await makeUser({ username: "hpu-mgr",   role: "manager",    siteId });
    owner = await makeUser({ username: "hpu-owner", role: "owner",      siteId: null });
    const { data: s } = await adminClient
      .from("suppliers").insert({ name: "HPU Supp", phone: "07088880000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
    const { data: mc } = await adminClient.from("machines")
      .insert({ site_id: siteId, name: "HPU Crusher", charge_basis: "weight", rate: 15 })
      .select("id").single();
    machineId = mc!.id;
  });

  it("walks a visit gate → processing → receiving → pricing(agreed) → in_accounting", async () => {
    // Gate intake
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      vehicle_plate: "HPU-001", entry_path: "unprocessed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    expect(v?.id).toBeTruthy();

    // Gate transition at_gate_in → in_processing
    await gate.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);

    // Processing record + machine usage
    const { data: pr } = await proc.client.from("processing_records")
      .insert({ visit_id: v!.id, recorded_by: proc.userId }).select("id").single();
    await proc.client.from("processing_machine_usage").insert({
      processing_record_id: pr!.id, machine_id: machineId,
      measurement: 320, rate_snapshot: 15,
    });

    // State should now be in_receiving (transition trigger fired)
    let { data: state1 } = await adminClient.from("visits").select("state").eq("id", v!.id).single();
    expect(state1?.state).toBe("in_receiving");

    // Analysis
    await recv.client.from("analysis_records").insert({
      visit_id: v!.id, weight: 305, grade: "A", purity: 65, recorded_by: recv.userId,
    });
    let { data: state2 } = await adminClient.from("visits").select("state").eq("id", v!.id).single();
    expect(state2?.state).toBe("pricing");

    // Pricing — agreed
    await mgr.client.from("pricing").insert({
      visit_id: v!.id, unit_price: 1200, agreement_status: "agreed",
      payment_terms: "installment", priced_by: mgr.userId,
    });
    let { data: state3 } = await adminClient.from("visits").select("state").eq("id", v!.id).single();
    expect(state3?.state).toBe("in_accounting");

    // Verify purchase_amount = 305 × 1200
    const { data: p } = await adminClient.from("pricing").select("purchase_amount").eq("visit_id", v!.id).single();
    expect(Number(p?.purchase_amount)).toBe(305 * 1200);

    // Verify event log shape
    const { data: events } = await adminClient.from("transaction_events")
      .select("event_type").eq("visit_id", v!.id).order("created_at");
    const types = events!.map(e => e.event_type);
    expect(types).toEqual(expect.arrayContaining([
      "visit_created", "state_changed", "record_created", "record_edited", // record_edited from purchase_amount touch
    ]));
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm run test -- tests/integration/happy-path-unprocessed.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/happy-path-unprocessed.test.ts
git commit -m "test(integration): happy path unprocessed → in_accounting

Phase 2 Task 22.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Integration test — pre_processed + no-agreement exit

**Files:**
- Create: `tests/integration/happy-path-preprocessed.test.ts`
- Create: `tests/integration/no-agreement-exit.test.ts`

- [ ] **Step 1: Write happy-path-preprocessed**

```typescript
// tests/integration/happy-path-preprocessed.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("happy path: pre_processed → agreed → in_accounting (no processing stage)", () => {
  let siteId: string;
  let gate: TestUser, recv: TestUser, mgr: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate = await makeUser({ username: "hpp-gate", role: "gate",      siteId });
    recv = await makeUser({ username: "hpp-recv", role: "receiving", siteId });
    mgr  = await makeUser({ username: "hpp-mgr",  role: "manager",   siteId });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "HPP Supp", phone: "07099990000" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("skips processing entirely", async () => {
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    await recv.client.from("analysis_records").insert({
      visit_id: v!.id, weight: 200, grade: "A", recorded_by: recv.userId,
    });
    await mgr.client.from("pricing").insert({
      visit_id: v!.id, unit_price: 1500, agreement_status: "agreed",
      payment_terms: "immediate", priced_by: mgr.userId,
    });
    const { data } = await adminClient.from("visits").select("state").eq("id", v!.id).single();
    expect(data?.state).toBe("in_accounting");

    // Verify no processing record exists
    const { data: pr } = await adminClient.from("processing_records").select("id").eq("visit_id", v!.id);
    expect(pr?.length).toBe(0);
  });
});
```

- [ ] **Step 2: Write no-agreement-exit**

```typescript
// tests/integration/no-agreement-exit.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("no-agreement exit path", () => {
  let siteId: string;
  let gate: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string, machineId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate  = await makeUser({ username: "nae-gate",  role: "gate",       siteId });
    recv  = await makeUser({ username: "nae-recv",  role: "receiving",  siteId });
    mgr   = await makeUser({ username: "nae-mgr",   role: "manager",    siteId });
    owner = await makeUser({ username: "nae-owner", role: "owner",      siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "NAE Supp", phone: "07011110001" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
    const { data: mc } = await adminClient.from("machines")
      .insert({ site_id: siteId, name: "NAE Crusher", charge_basis: "weight", rate: 10 })
      .select("id").single();
    machineId = mc!.id;
  });

  it("unprocessed: manager rejects, owner authorizes, gate releases — processing fee still owed", async () => {
    // Walk to pricing with a processing fee
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "unprocessed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);

    const proc = await makeUser({ username: "nae-proc", role: "processing", siteId });
    const { data: pr } = await proc.client.from("processing_records")
      .insert({ visit_id: v!.id, recorded_by: proc.userId }).select("id").single();
    await proc.client.from("processing_machine_usage").insert({
      processing_record_id: pr!.id, machine_id: machineId, measurement: 100, rate_snapshot: 10,
    });

    await recv.client.from("analysis_records")
      .insert({ visit_id: v!.id, weight: 0.1, grade: "F", recorded_by: recv.userId });

    // Manager rejects
    await mgr.client.from("pricing").insert({
      visit_id: v!.id, agreement_status: "not_agreed", priced_by: mgr.userId,
    });
    let { data: s1 } = await adminClient.from("visits").select("state").eq("id", v!.id).single();
    expect(s1?.state).toBe("awaiting_gate_exit");

    // Owner authorizes
    await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: v!.id, authorized_by: owner.userId, note: "client takes material back" });

    // Gate releases
    await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);
    const { data: final } = await adminClient.from("visits").select("state, closed_at").eq("id", v!.id).single();
    expect(final?.state).toBe("exited");
    expect(final?.closed_at).not.toBeNull();

    // Processing fee still owed: usage rows exist
    const { data: usage } = await adminClient.from("processing_machine_usage")
      .select("line_cost").eq("processing_record_id", pr!.id);
    expect(Number(usage![0].line_cost)).toBe(100 * 10);
  });

  it("pre_processed: nothing owed when exiting without agreement", async () => {
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    await recv.client.from("analysis_records")
      .insert({ visit_id: v!.id, weight: 0.5, grade: "F", recorded_by: recv.userId });
    await mgr.client.from("pricing")
      .insert({ visit_id: v!.id, agreement_status: "not_agreed", priced_by: mgr.userId });
    await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: v!.id, authorized_by: owner.userId });
    await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);

    const { data: pr } = await adminClient.from("processing_records").select("id").eq("visit_id", v!.id);
    expect(pr?.length).toBe(0);  // no processing fee at all
  });
});
```

- [ ] **Step 3: Run both**

```bash
npm run test -- tests/integration/happy-path-preprocessed.test.ts tests/integration/no-agreement-exit.test.ts
```

Expected: 1 + 2 passing.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/happy-path-preprocessed.test.ts tests/integration/no-agreement-exit.test.ts
git commit -m "test(integration): pre_processed happy path + both no-agreement exits

Phase 2 Task 23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: Integration test — edit-while-open + edit-after-close + owner override

**Files:**
- Create: `tests/integration/edit-while-open.test.ts`
- Create: `tests/integration/edit-after-close.test.ts`
- Create: `tests/state-machine/owner-override.test.ts`
- Create: `tests/state-machine/invariants.test.ts`

- [ ] **Step 1: Write edit-while-open**

```typescript
// tests/integration/edit-while-open.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("edit-while-open: each role can edit own record on an open visit", () => {
  let siteId: string;
  let gate: TestUser, recv: TestUser, mgr: TestUser;
  let supplierId: string, materialTypeId: string;

  async function freshVisitInPricing() {
    const { data: v } = await adminClient.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "in_receiving", created_by: gate.userId,
    }).select("id").single();
    const { data: a } = await recv.client.from("analysis_records")
      .insert({ visit_id: v!.id, weight: 100, recorded_by: recv.userId }).select("id").single();
    return { vid: v!.id, aid: a!.id };
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate = await makeUser({ username: "ewo-gate", role: "gate",      siteId });
    recv = await makeUser({ username: "ewo-recv", role: "receiving", siteId });
    mgr  = await makeUser({ username: "ewo-mgr",  role: "manager",   siteId });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "EWO Supp", phone: "07022220001" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("receiving can edit analysis after the visit moves to pricing", async () => {
    const { vid, aid } = await freshVisitInPricing();
    const { error } = await recv.client.from("analysis_records").update({ weight: 120 }).eq("id", aid);
    expect(error).toBeNull();
    const { data: events } = await adminClient.from("transaction_events")
      .select("event_type, payload").eq("visit_id", vid).eq("event_type", "record_edited");
    expect(events!.length).toBeGreaterThan(0);
  });

  it("manager edit of unit_price writes record_edited with diff", async () => {
    const { vid } = await freshVisitInPricing();
    const { data: p } = await mgr.client.from("pricing")
      .insert({ visit_id: vid, unit_price: 1000, agreement_status: "pending", priced_by: mgr.userId })
      .select("id").single();
    await mgr.client.from("pricing").update({ unit_price: 1100 }).eq("id", p!.id);
    const { data: events } = await adminClient.from("transaction_events")
      .select("payload").eq("visit_id", vid).eq("event_type", "record_edited").order("created_at", { ascending: false }).limit(1);
    const diff = (events![0].payload as { diff?: { unit_price?: { old: number; new: number } } }).diff;
    expect(diff?.unit_price).toEqual({ old: 1000, new: 1100 });
  });
});
```

- [ ] **Step 2: Write edit-after-close**

```typescript
// tests/integration/edit-after-close.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("edit-after-close: non-owner blocked, owner allowed", () => {
  let siteId: string;
  let gate: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate  = await makeUser({ username: "eac-gate",  role: "gate",       siteId });
    recv  = await makeUser({ username: "eac-recv",  role: "receiving",  siteId });
    mgr   = await makeUser({ username: "eac-mgr",   role: "manager",    siteId });
    owner = await makeUser({ username: "eac-owner", role: "owner",      siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "EAC Supp", phone: "07033330001" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("after exited, receiving cannot edit analysis; owner can", async () => {
    // Walk to exited
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    const { data: a } = await recv.client.from("analysis_records")
      .insert({ visit_id: v!.id, weight: 50, recorded_by: recv.userId }).select("id").single();
    await mgr.client.from("pricing")
      .insert({ visit_id: v!.id, agreement_status: "not_agreed", priced_by: mgr.userId });
    await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: v!.id, authorized_by: owner.userId });
    await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);

    // Receiving cannot edit closed visit's analysis
    await recv.client.from("analysis_records").update({ weight: 75 }).eq("id", a!.id);
    const { data: stillSame } = await adminClient
      .from("analysis_records").select("weight").eq("id", a!.id).single();
    expect(Number(stillSame?.weight)).toBe(50);

    // Owner can edit
    const { error } = await owner.client.from("analysis_records").update({ weight: 80 }).eq("id", a!.id);
    expect(error).toBeNull();
    const { data: edited } = await adminClient
      .from("analysis_records").select("weight").eq("id", a!.id).single();
    expect(Number(edited?.weight)).toBe(80);
  });
});
```

- [ ] **Step 3: Write owner-override state-machine test**

```typescript
// tests/state-machine/owner-override.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("owner-override events", () => {
  let siteId: string, gate: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate  = await makeUser({ username: "oo-gate",  role: "gate",  siteId });
    owner = await makeUser({ username: "oo-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "OO Supp", phone: "07044440001" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("owner backward state move writes owner_override", async () => {
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "unprocessed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);

    // Owner rolls back
    await owner.client.from("visits").update({ state: "at_gate_in" }).eq("id", v!.id);

    const { data: events } = await adminClient.from("transaction_events")
      .select("event_type").eq("visit_id", v!.id).order("created_at");
    expect(events!.map(e => e.event_type)).toContain("owner_override");
  });
});
```

- [ ] **Step 4: Write invariants test**

```typescript
// tests/state-machine/invariants.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("state-machine invariants", () => {
  let siteId: string, gate: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate  = await makeUser({ username: "inv-gate",  role: "gate",    siteId });
    mgr   = await makeUser({ username: "inv-mgr",   role: "manager", siteId });
    owner = await makeUser({ username: "inv-owner", role: "owner",   siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "INV Supp", phone: "07055550001" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("cannot enter pricing without analysis_records", async () => {
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await owner.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    const { error } = await owner.client.from("visits").update({ state: "pricing" }).eq("id", v!.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/analysis_records/);
  });

  it("cannot enter exited without gate_exit_authorizations row", async () => {
    const { data: v } = await owner.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "awaiting_gate_exit", created_by: owner.userId,
    }).select("id").single();
    const { error } = await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/gate_exit_authorizations/);
  });
});
```

- [ ] **Step 5: Run all four**

```bash
npm run test -- tests/integration/edit-while-open.test.ts tests/integration/edit-after-close.test.ts tests/state-machine/owner-override.test.ts tests/state-machine/invariants.test.ts
```

Expected: 2 + 1 + 1 + 2 passing.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/edit-while-open.test.ts tests/integration/edit-after-close.test.ts tests/state-machine/owner-override.test.ts tests/state-machine/invariants.test.ts
git commit -m "test: edit policy + owner override + state-machine invariants

Phase 2 Task 24.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: Audit-log events written test

**Files:**
- Create: `tests/audit/events-written.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/audit/events-written.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("transaction_events written by triggers", () => {
  let siteId: string, gate: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient.from("sites").select("id").limit(1);
    siteId = sites![0].id;
    gate  = await makeUser({ username: "ew-gate",  role: "gate",       siteId });
    recv  = await makeUser({ username: "ew-recv",  role: "receiving",  siteId });
    mgr   = await makeUser({ username: "ew-mgr",   role: "manager",    siteId });
    owner = await makeUser({ username: "ew-owner", role: "owner",      siteId: null });
    const { data: s } = await adminClient.from("suppliers")
      .insert({ name: "EW Supp", phone: "07066660001" }).select("id").single();
    supplierId = s!.id;
    const { data: m } = await adminClient.from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id;
  });

  it("each action produces exactly one event row", async () => {
    const { data: v } = await gate.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "pre_processed", state: "at_gate_in", created_by: gate.userId,
    }).select("id").single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    await recv.client.from("analysis_records")
      .insert({ visit_id: v!.id, weight: 50, recorded_by: recv.userId });
    await mgr.client.from("pricing").insert({
      visit_id: v!.id, unit_price: 100, agreement_status: "agreed",
      payment_terms: "immediate", priced_by: mgr.userId,
    });

    const { data: events } = await adminClient.from("transaction_events")
      .select("event_type, payload").eq("visit_id", v!.id).order("created_at");
    const types = events!.map(e => e.event_type);
    // visit_created, state_changed(at_gate_in→in_receiving), record_created(analysis),
    // state_changed(in_receiving→pricing), record_created(pricing), state_changed(pricing→in_accounting)
    expect(types.filter(t => t === "visit_created").length).toBe(1);
    expect(types.filter(t => t === "state_changed").length).toBe(3);
    expect(types.filter(t => t === "record_created").length).toBe(2);
  });

  it("client cannot directly insert transaction_events", async () => {
    const { error } = await gate.client.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000000",
      event_type: "visit_created", payload: {},
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test -- tests/audit/events-written.test.ts
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/audit/events-written.test.ts
git commit -m "test(audit): verify trigger writes per action + client-DML denial

Phase 2 Task 25.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 26: Acceptance gate — full suite + Playwright + build

**Files:** (no new files; verification only)

- [ ] **Step 1: Run the entire test suite**

```bash
npx supabase db reset
npm run test
```

Expected: All Phase 1 (13) + all Phase 2 tests pass. Approximate counts:
- RLS: 5 + 4 + 5 + 3 + 5 + 5 + 7 + 6 = 40
- State machine: 4 + 1 + 2 = 7
- Integration: 2 + 1 + 1 + 2 + 1 + 2 = 9
- Audit: 3 + 2 = 5
- Lib: 5
- Phase 1 carry-over: 13
- **Total: ~79 tests**

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: Clean build, zero TS errors.

- [ ] **Step 3: Provision an Owner and one user per role for manual walkthrough**

If not already provisioned in dev, use the Phase 1 bootstrap script and the Owner UI to create users named `gate1`, `proc1`, `recv1`, `mgr1` at the same site for walkthrough purposes. Provision Owner via the Phase 1 server-side script if needed.

- [ ] **Step 4: Playwright happy path (manual)**

```bash
npm run dev
```

In a browser, log in as each role in turn and walk:
1. `gate1` → `/gate/intake` → fill form (search supplier → add new → fill visit → "Unprocessed") → submit. Verify redirect to `/visits/[id]` showing state=`in_processing`.
2. `proc1` → `/processing` → click the new visit → fill ProcessingCard (one machine usage) → submit. Verify state=`in_receiving`.
3. `recv1` → `/receiving` → click visit → fill AnalysisCard (weight, grade) → submit. Verify state=`pricing`.
4. `mgr1` → `/manager` → click visit → set unit price, mark agreed, pick payment terms → submit. Verify state=`in_accounting`.

Confirm the audit trail on `/visits/[id]` shows all expected events.

- [ ] **Step 5: Playwright no-agreement path (manual)**

Repeat steps 1–3 then:
4. `mgr1` → mark `not_agreed` → submit. Verify state=`awaiting_gate_exit`.
5. Log in as Owner → `/owner` → click visit in "Awaiting your sign-off" → click "Authorize exit". Verify the ExitAuthorizationCard now shows the authorization timestamp.
6. Log out, log in as `gate1` → `/gate` → click visit in "Awaiting release" → click "Release supplier". Verify state=`exited`, closed_at is set, page shows the final timeline.

- [ ] **Step 6: Commit completion marker**

```bash
git tag phase-2-visit-workflow
git log --oneline phase-1-foundation..HEAD | head -30
```

Expected: A clean string of Phase 2 commits (≈26 commits). Tag is created locally.

- [ ] **Step 7: Open PR (when ready)**

```bash
gh pr create --base main --title "Phase 2: Inbound visit workflow" --body "Implements the gate intake → processing → receiving → pricing pipeline plus the owner-authorized no-agreement gate exit. See \`docs/superpowers/specs/2026-05-29-phase-2-visit-workflow-design.md\` for the spec.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

**Spec coverage check:**
- §3 Data Model — all tables created (Tasks 1–9) ✓
- §4 State Machine — Task 5 + child-record transition triggers in Tasks 6/7/8 + invariant tests in Task 24 ✓
- §5 RLS — embedded in each migration task; explicit RLS tests per table ✓
- §6 Triggers — covered across Tasks 5/6/7/8/9 ✓
- §7 Role Screens — Tasks 12 (Gate intake), 13 (Gate home), 14 (Processing), 15 (Receiving), 16 (Manager), 17 (Owner home + authorize), 18 (Shared visit detail), 19/20/21 (Owner config) ✓
- §8 Server Actions — covered in Tasks 12/14/15/16/17/19/20 ✓
- §9 Migrations 0006–0014 — Tasks 1–9 ✓
- §10 Testing — Tasks 1–10, 22–25 ✓
- §11 Out-of-scope deferrals — respected (no Accountant / inventory / PDFs) ✓
- §12 Conventions reaffirmed — TDD followed; column-level GRANTs used; service-role key not added; `server-only` imported in queries module ✓

**Placeholder scan:** No "TBD", no "TODO", no vague "add validation" — every action and form has its complete code.

**Type consistency:** `VisitState`, `IntakeState`, `ProcessingState`, `AnalysisState`, `PricingState`, `AuthorizeState`, `MtState`, `MachineState` are all defined in the tasks that introduce them and referenced consistently afterward. The `get1` helper for Supabase array-relations is used uniformly in the visit detail page.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-29-phase-2-visit-workflow.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks, continuous progress.

**2. Inline Execution** — I execute tasks in this session with batched checkpoints.

Which approach?




