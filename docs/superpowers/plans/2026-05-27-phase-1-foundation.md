# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + Supabase foundation: a user can log in by username, is routed to their role's home screen, cannot reach other roles' screens, and the Owner can provision new employees with a role + site and a one-time temporary password.

**Architecture:** Next.js App Router (TypeScript) on Vercel, talking to Supabase (Postgres + Auth) via `@supabase/ssr` cookie sessions. Authorization is enforced in Postgres with Row-Level Security keyed on `profiles.role` + `profiles.site_id`. Privileged actions (provisioning) run in server actions using the Supabase service-role key, never exposed to the browser. Login is email-free: usernames map to synthetic internal emails.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, `@supabase/supabase-js`, `@supabase/ssr`, Supabase CLI (local Postgres + migrations), Vitest (unit + RLS integration tests).

**Reference spec:** `docs/superpowers/specs/2026-05-27-mining-inventory-system-design.md` (§2 Architecture, §3 Roles, §9 Auth & Provisioning).

---

## Pre-flight (already done before this plan starts)

These were completed in the setup session immediately before Phase 1 begins — do **not** redo them:

- `.gitignore` and `.env.example` exist; `.env.local` exists and is pre-filled with **local** Supabase keys from `supabase status -o env`. `.env.cloud.local` separately holds the cloud project's creds for later Vercel deploy. Both are gitignored.
- `npx supabase init` has been run — `supabase/config.toml` exists and is committed. **Do NOT re-run `supabase init`.**
- `npx supabase start` is already running (local stack on `http://127.0.0.1:54321`, Studio at `http://127.0.0.1:54323`). If it has stopped, restart with `npx supabase start`.
- The cloud project (`wevkljmhucuhfqjgeqcb`) has **"Allow new users to sign up"** turned **OFF** in Authentication settings (required for the security model).

Verify pre-flight at the start of execution:

```bash
test -f .env.local && grep -q "127.0.0.1:54321" .env.local && echo "env OK" || echo "env MISSING — abort"
test -f supabase/config.toml && echo "supabase init OK" || echo "supabase init MISSING — abort"
npx supabase status >/dev/null 2>&1 && echo "supabase running OK" || echo "supabase NOT running — run 'npx supabase start'"
```
Expected: three "OK" lines.

---

## File Structure

```
package.json
.env.local                              # gitignored; Supabase URL + keys
.env.example                            # committed template
next.config.ts
tailwind.config.ts
vitest.config.ts
middleware.ts                           # role-based route guard
supabase/
  config.toml                           # supabase CLI config
  migrations/
    0001_sites.sql
    0002_roles_enum_and_profiles.sql
    0003_profiles_rls.sql
    0004_setup_codes.sql
src/
  lib/supabase/
    client.ts                           # browser client
    server.ts                           # server-component / action client (cookie-bound)
    admin.ts                            # service-role client (server-only)
  lib/auth/
    roles.ts                            # Role type + ROLE_HOME map (single source of truth)
    get-profile.ts                      # load current user's profile server-side
  lib/provisioning/
    provision-user.ts                   # server action: owner creates employee
    username.ts                         # username <-> synthetic email helpers
  app/
    layout.tsx
    page.tsx                            # redirects to role home or /login
    login/page.tsx
    login/actions.ts                    # signIn server action
    set-password/page.tsx               # forced first-login password change
    set-password/actions.ts
    (gate)/gate/page.tsx
    (processing)/processing/page.tsx
    (receiving)/receiving/page.tsx
    (manager)/manager/page.tsx
    (accounting)/accounting/page.tsx
    (inventory)/inventory/page.tsx
    (owner)/owner/page.tsx
    (owner)/owner/employees/page.tsx    # provisioning UI
    (owner)/owner/employees/actions.ts
tests/
  setup/supabase-test-clients.ts        # helpers to build clients with given JWTs
  rls/profiles.rls.test.ts
  auth/roles.test.ts
  provisioning/username.test.ts
```

**Responsibilities:**
- `lib/supabase/*` — one file per client kind; no business logic.
- `lib/auth/roles.ts` — the only place the role list and per-role home path live.
- `middleware.ts` — pure routing guard; reads session + profile, redirects.
- `lib/provisioning/*` — owner-only account creation, isolated so the service-role key never leaks into client bundles.

---

## Task 1: Scaffold Next.js + Tailwind + tooling

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Scaffold the app**

Run (non-interactive flags pre-answer every prompt):
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```
Expected: project files created in the current directory; `package.json`, `src/app/`, `tailwind.config.ts` exist.

- [ ] **Step 2: Verify it builds and runs**

Run:
```bash
npm run build
```
Expected: build completes with "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + TypeScript + Tailwind app"
```

---

## Task 2: Add Supabase libraries, env template, and clients

**Files:**
- Create: `.env.example`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`
- Modify: `.gitignore` (ensure `.env.local` ignored — create-next-app already ignores `.env*`)

- [ ] **Step 1: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr
```
Expected: both packages added to `package.json` dependencies.

- [ ] **Step 2: Create the env template**

`.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SYNTHETIC_EMAIL_DOMAIN=magneticjoezion.local
```

- [ ] **Step 3: Browser client**

`src/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 4: Server (cookie-bound) client**

`src/lib/supabase/server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component; middleware refreshes the session instead
          }
        },
      },
    },
  );
}
```

- [ ] **Step 5: Service-role (admin) client — server only**

`src/lib/supabase/admin.ts`:
```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Step 6: Install the `server-only` guard package**

```bash
npm install server-only
```
Expected: `server-only` added to dependencies (build will fail if `admin.ts` is ever imported into a client component).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add supabase clients and env template"
```

---

## Task 3: First migration (sites)

**Files:**
- Create: `supabase/migrations/0001_sites.sql`

> `supabase init` and `supabase start` were completed in pre-flight — do not re-run them.
> Confirm the stack is up with `npx supabase status` before continuing.

- [ ] **Step 1: Confirm the stack is running**

```bash
npx supabase status
```
Expected: prints the API URL, DB URL, and keys. If it errors, run `npx supabase start` and try again.

- [ ] **Step 2: (intentionally empty — `start` already done in pre-flight)**

Skip; proceed to Step 3.

- [ ] **Step 3: Write the sites migration**

`supabase/migrations/0001_sites.sql`:
```sql
create extension if not exists "pgcrypto";

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  created_at timestamptz not null default now()
);

alter table public.sites enable row level security;

-- Seed the three real sites.
insert into public.sites (name) values
  ('Site 1'), ('Site 2'), ('Site 3');
```

- [ ] **Step 4: Apply the migration**

```bash
npx supabase migration up
```
Expected: migration `0001_sites` applied; no errors.

- [ ] **Step 5: Verify the seed**

```bash
npx supabase db reset
```
Expected: reset re-applies all migrations and seeds 3 sites without error (confirms migration is reproducible from scratch).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_sites.sql
git commit -m "feat: sites table migration"
```
(`supabase/config.toml` was already committed in pre-flight.)

---

## Task 4: Roles enum + profiles table

**Files:**
- Create: `supabase/migrations/0002_roles_enum_and_profiles.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/0002_roles_enum_and_profiles.sql`:
```sql
create type public.app_role as enum (
  'gate', 'processing', 'receiving', 'manager', 'accounting', 'inventory', 'owner'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text not null unique,
  role public.app_role not null,
  site_id uuid references public.sites(id),  -- null only for owner (cross-site)
  status text not null default 'active' check (status in ('active', 'disabled')),
  must_change_password boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint owner_has_no_site check (role <> 'owner' or site_id is null),
  constraint non_owner_has_site check (role = 'owner' or site_id is not null)
);

alter table public.profiles enable row level security;

-- Helper: current user's role, used by RLS across the whole app.
create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Helper: current user's site.
create or replace function public.current_site()
returns uuid
language sql stable security definer set search_path = public as $$
  select site_id from public.profiles where id = auth.uid();
$$;

-- Helper: is the current user the owner?
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'owner', false);
$$;
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase migration up
```
Expected: `0002` applied; `\d public.profiles` (via `npx supabase db reset` then psql) shows the table. Quick check:
```bash
npx supabase db reset
```
Expected: all migrations apply cleanly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_roles_enum_and_profiles.sql
git commit -m "feat: app_role enum, profiles table, and RLS helper functions"
```

---

## Task 5: RLS policies for profiles (with tests)

**Files:**
- Create: `supabase/migrations/0003_profiles_rls.sql`, `tests/setup/supabase-test-clients.ts`, `tests/rls/profiles.rls.test.ts`, `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    fileParallelism: false, // RLS tests share one local DB
  },
});
```

- [ ] **Step 3: Test client helpers**

`tests/setup/supabase-test-clients.ts`:
```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Create a confirmed auth user + profile and return a client signed in as them.
export async function makeUser(opts: {
  username: string;
  role: string;
  siteId: string | null;
}): Promise<{ client: SupabaseClient; id: string }> {
  const admin = adminClient();
  const email = `${opts.username}@magneticjoezion.local`;
  const password = "test-password-123";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  const { error: pErr } = await admin.from("profiles").insert({
    id,
    full_name: opts.username,
    username: opts.username,
    role: opts.role,
    site_id: opts.siteId,
    must_change_password: false,
  });
  if (pErr) throw pErr;

  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { client, id };
}

export async function firstSiteId(): Promise<string> {
  const { data } = await adminClient().from("sites").select("id").limit(1).single();
  return data!.id as string;
}
```

- [ ] **Step 4: Write the failing RLS test**

`tests/rls/profiles.rls.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, makeUser, firstSiteId } from "../setup/supabase-test-clients";

describe("profiles RLS", () => {
  beforeAll(async () => {
    // Clean slate for auth users + profiles between runs.
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers();
    for (const u of data.users) await admin.auth.admin.deleteUser(u.id);
  });

  it("a user can read their own profile", async () => {
    const siteId = await firstSiteId();
    const { client, id } = await makeUser({ username: "gate1", role: "gate", siteId });
    const { data, error } = await client.from("profiles").select("*").eq("id", id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("a non-owner cannot read another user's profile", async () => {
    const siteId = await firstSiteId();
    const a = await makeUser({ username: "gate2", role: "gate", siteId });
    const b = await makeUser({ username: "acct2", role: "accounting", siteId });
    const { data } = await a.client.from("profiles").select("*").eq("id", b.id);
    expect(data).toHaveLength(0); // RLS filters it out, not an error
  });

  it("the owner can read every profile", async () => {
    const siteId = await firstSiteId();
    await makeUser({ username: "gate3", role: "gate", siteId });
    const owner = await makeUser({ username: "owner1", role: "owner", siteId: null });
    const { data } = await owner.client.from("profiles").select("*");
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 5: Run the test to verify it FAILS**

Run:
```bash
npm run test -- tests/rls/profiles.rls.test.ts
```
First add the script to `package.json`: `"test": "vitest run"`.
Expected: FAIL — with no policies, either every select returns empty (owner test fails) or RLS defaults block reads. Confirms tests exercise real policies.

- [ ] **Step 6: Write the RLS policy migration**

`supabase/migrations/0003_profiles_rls.sql`:
```sql
-- Read own profile.
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

-- Owner reads all profiles.
create policy "owner reads all profiles" on public.profiles
  for select using (public.is_owner());

-- Users can update only their own password-change flag / name.
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Inserts/role changes happen only via the service-role key (provisioning),
-- which bypasses RLS — so no INSERT policy is granted to normal users.
```

- [ ] **Step 7: Apply and run tests to verify PASS**

```bash
npx supabase db reset && npm run test -- tests/rls/profiles.rls.test.ts
```
Expected: PASS — own-profile read works, cross-user read is empty, owner sees all.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0003_profiles_rls.sql tests/ vitest.config.ts package.json
git commit -m "feat: profiles RLS policies with passing RLS tests"
```

---

## Task 6: Roles single-source-of-truth + unit test

**Files:**
- Create: `src/lib/auth/roles.ts`, `tests/auth/roles.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/auth/roles.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ROLE_HOME, ROLES } from "@/lib/auth/roles";

describe("roles", () => {
  it("defines all seven roles", () => {
    expect(ROLES).toEqual([
      "gate", "processing", "receiving", "manager", "accounting", "inventory", "owner",
    ]);
  });

  it("maps every role to a home path", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toMatch(/^\/[a-z]+$/);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it FAILS**

```bash
npm run test -- tests/auth/roles.test.ts
```
Expected: FAIL — `@/lib/auth/roles` not found.

- [ ] **Step 3: Implement**

`src/lib/auth/roles.ts`:
```ts
export const ROLES = [
  "gate", "processing", "receiving", "manager", "accounting", "inventory", "owner",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  gate: "/gate",
  processing: "/processing",
  receiving: "/receiving",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  owner: "/owner",
};
```

- [ ] **Step 4: Run it to verify it PASSES**

```bash
npm run test -- tests/auth/roles.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/roles.ts tests/auth/roles.test.ts
git commit -m "feat: single source of truth for roles and role home paths"
```

---

## Task 7: Username/synthetic-email helper + unit test

**Files:**
- Create: `src/lib/provisioning/username.ts`, `tests/provisioning/username.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/provisioning/username.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { usernameToEmail, normalizeUsername } from "@/lib/provisioning/username";

describe("username helpers", () => {
  it("normalizes to lowercase, trims, no spaces", () => {
    expect(normalizeUsername("  Gate User ")).toBe("gate_user");
  });

  it("maps a username to the synthetic email domain", () => {
    expect(usernameToEmail("gate1", "magneticjoezion.local"))
      .toBe("gate1@magneticjoezion.local");
  });

  it("rejects empty usernames", () => {
    expect(() => normalizeUsername("   ")).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it FAILS**

```bash
npm run test -- tests/provisioning/username.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/provisioning/username.ts`:
```ts
export function normalizeUsername(raw: string): string {
  const u = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!u) throw new Error("Username cannot be empty");
  if (!/^[a-z0-9_]+$/.test(u)) throw new Error("Username must be alphanumeric/underscore");
  return u;
}

export function usernameToEmail(username: string, domain: string): string {
  return `${normalizeUsername(username)}@${domain}`;
}
```

- [ ] **Step 4: Run it to verify it PASSES**

```bash
npm run test -- tests/provisioning/username.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provisioning/username.ts tests/provisioning/username.test.ts
git commit -m "feat: username normalization and synthetic email mapping"
```

---

## Task 8: Load current profile server-side

**Files:**
- Create: `src/lib/auth/get-profile.ts`

- [ ] **Step 1: Implement the profile loader**

`src/lib/auth/get-profile.ts`:
```ts
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth/roles";

export type Profile = {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  site_id: string | null;
  must_change_password: boolean;
};

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, site_id, must_change_password")
    .eq("id", user.id)
    .single();
  return (data as Profile) ?? null;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/get-profile.ts
git commit -m "feat: server-side current profile loader"
```

---

## Task 9: Login page + signIn action

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/actions.ts`

- [ ] **Step 1: signIn server action**

`src/app/login/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/provisioning/username";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

export async function signIn(_prev: unknown, formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username, domain),
    password,
  });
  if (error) return { error: "Invalid username or password" };

  const profile = await getProfile();
  if (!profile) return { error: "No profile found for this account" };
  if (profile.must_change_password) redirect("/set-password");
  redirect(ROLE_HOME[profile.role]);
}
```

- [ ] **Step 2: Login page**

`src/app/login/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">MAGNETIC JOEZION NIG. LTD</h1>
      <form action={action} className="flex flex-col gap-3">
        <input name="username" placeholder="Username" required
          className="rounded border p-2" />
        <input name="password" type="password" placeholder="Password" required
          className="rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Type-check + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/
git commit -m "feat: username/password login page and signIn action"
```

---

## Task 10: Role-based routing middleware

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Implement the guard**

`middleware.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ROLE_HOME, type Role } from "@/lib/auth/roles";

const PUBLIC_PATHS = ["/login", "/set-password"];

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
    if (PUBLIC_PATHS.some((p) => path.startsWith(p))) return res;
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.redirect(new URL("/login", req.url));

  if (profile.must_change_password && path !== "/set-password") {
    return NextResponse.redirect(new URL("/set-password", req.url));
  }

  const home = ROLE_HOME[profile.role as Role];
  // Owner may visit any route; other roles are confined to their own home subtree.
  if (profile.role !== "owner" && !path.startsWith(home) && !PUBLIC_PATHS.includes(path)) {
    return NextResponse.redirect(new URL(home, req.url));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg)).*)"],
};
```

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: compiles; middleware bundled.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: role-based routing middleware guard"
```

---

## Task 11: Seven role landing pages + root redirect + set-password

**Files:**
- Create: `src/app/(gate)/gate/page.tsx`, `(processing)/processing/page.tsx`, `(receiving)/receiving/page.tsx`, `(manager)/manager/page.tsx`, `(accounting)/accounting/page.tsx`, `(inventory)/inventory/page.tsx`, `(owner)/owner/page.tsx`, `src/app/set-password/page.tsx`, `src/app/set-password/actions.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Root redirect**

`src/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.must_change_password) redirect("/set-password");
  redirect(ROLE_HOME[profile.role]);
}
```

- [ ] **Step 2: Create one landing page per role**

Each role page follows this template — repeat for all seven, changing the title and path. Example `src/app/(gate)/gate/page.tsx`:
```tsx
import { getProfile } from "@/lib/auth/get-profile";

export default async function GatePage() {
  const profile = await getProfile();
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Gate / Security</h1>
      <p className="text-sm text-gray-600">
        Signed in as {profile?.full_name} ({profile?.username})
      </p>
    </main>
  );
}
```
Repeat for: `(processing)/processing/page.tsx` (title "Processing Plant"),
`(receiving)/receiving/page.tsx` ("Receiving & Analysis"),
`(manager)/manager/page.tsx` ("Manager"),
`(accounting)/accounting/page.tsx` ("Accounting"),
`(inventory)/inventory/page.tsx` ("Inventory Manager"),
`(owner)/owner/page.tsx` ("Owner — Oversight").

- [ ] **Step 3: set-password action**

`src/app/set-password/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

export async function setPassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  await supabase.from("profiles").update({ must_change_password: false }).eq("id", user!.id);

  const profile = await getProfile();
  redirect(ROLE_HOME[profile!.role]);
}
```

- [ ] **Step 4: set-password page**

`src/app/set-password/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { setPassword } from "./actions";

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, null);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <form action={action} className="flex flex-col gap-3">
        <input name="password" type="password" placeholder="New password" required
          className="rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save password"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Build**

```bash
npm run build
```
Expected: all seven routes + set-password compile.

- [ ] **Step 6: Commit**

```bash
git add src/app/
git commit -m "feat: seven role landing pages, root redirect, forced password change"
```

---

## Task 12: setup_codes table (audit of provisioning) + migration

**Files:**
- Create: `supabase/migrations/0004_setup_codes.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/0004_setup_codes.sql`:
```sql
-- Records each provisioning event for audit. The temp password itself is NOT stored;
-- only a record that an account was created and whether it has been used (logged in).
create table public.setup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  role public.app_role not null,
  site_id uuid references public.sites(id),
  created_by uuid not null references auth.users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.setup_codes enable row level security;

create policy "owner reads setup codes" on public.setup_codes
  for select using (public.is_owner());
-- Inserts happen via service-role provisioning only (bypasses RLS).
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
```
Expected: all four migrations apply cleanly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_setup_codes.sql
git commit -m "feat: setup_codes audit table for provisioning"
```

---

## Task 13: Owner provisioning server action (with integration test)

**Files:**
- Create: `src/lib/provisioning/provision-user.ts`, `tests/provisioning/provision-user.test.ts`

- [ ] **Step 1: Write the failing integration test**

`tests/provisioning/provision-user.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, firstSiteId } from "../setup/supabase-test-clients";
import { provisionUser } from "@/lib/provisioning/provision-user";

describe("provisionUser", () => {
  beforeAll(async () => {
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers();
    for (const u of data.users) await admin.auth.admin.deleteUser(u.id);
  });

  it("creates an auth user + profile + setup_code row and returns a temp password", async () => {
    const siteId = await firstSiteId();
    const result = await provisionUser(
      { fullName: "Gate One", username: "gate_one", role: "gate", siteId },
      "00000000-0000-0000-0000-000000000000", // created_by (owner) id
    );
    expect(result.tempPassword).toHaveLength(12);

    const admin = adminClient();
    const { data: profile } = await admin.from("profiles")
      .select("*").eq("username", "gate_one").single();
    expect(profile?.role).toBe("gate");
    expect(profile?.must_change_password).toBe(true);

    const { data: codes } = await admin.from("setup_codes")
      .select("*").eq("username", "gate_one");
    expect(codes).toHaveLength(1);
  });

  it("rejects a duplicate username", async () => {
    const siteId = await firstSiteId();
    await expect(
      provisionUser(
        { fullName: "Dupe", username: "gate_one", role: "gate", siteId },
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it FAILS**

```bash
npm run test -- tests/provisioning/provision-user.test.ts
```
Expected: FAIL — `provision-user` module not found.

- [ ] **Step 3: Implement provisioning**

`src/lib/provisioning/provision-user.ts`:
```ts
import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeUsername, usernameToEmail } from "@/lib/provisioning/username";
import type { Role } from "@/lib/auth/roles";

export type ProvisionInput = {
  fullName: string;
  username: string;
  role: Role;
  siteId: string | null;
};

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

export async function provisionUser(input: ProvisionInput, createdBy: string) {
  const username = normalizeUsername(input.username);
  const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";
  const tempPassword = generateTempPassword();
  const admin = createAdminClient();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username, domain),
    password: tempPassword,
    email_confirm: true,
  });
  if (authErr || !created.user) throw new Error(authErr?.message ?? "Auth create failed");
  const userId = created.user.id;

  const { error: profErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: input.fullName,
    username,
    role: input.role,
    site_id: input.role === "owner" ? null : input.siteId,
    must_change_password: true,
    created_by: createdBy,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(userId); // roll back the orphaned auth user
    throw new Error(profErr.message);
  }

  await admin.from("setup_codes").insert({
    user_id: userId,
    username,
    role: input.role,
    site_id: input.role === "owner" ? null : input.siteId,
    created_by: createdBy,
  });

  return { userId, username, tempPassword };
}
```

- [ ] **Step 4: Run it to verify it PASSES**

```bash
npx supabase db reset && npm run test -- tests/provisioning/provision-user.test.ts
```
Expected: PASS — user/profile/setup_code created; duplicate username rejected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provisioning/provision-user.ts tests/provisioning/provision-user.test.ts
git commit -m "feat: owner provisioning of employee accounts with temp password"
```

---

## Task 14: Owner "Add Employee" screen wired to provisioning

**Files:**
- Create: `src/app/(owner)/owner/employees/page.tsx`, `src/app/(owner)/owner/employees/actions.ts`

- [ ] **Step 1: Server action that guards owner-only and calls provisioning**

`src/app/(owner)/owner/employees/actions.ts`:
```ts
"use server";

import { getProfile } from "@/lib/auth/get-profile";
import { provisionUser } from "@/lib/provisioning/provision-user";
import type { Role } from "@/lib/auth/roles";

export async function addEmployee(_prev: unknown, formData: FormData) {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Not authorized" };

  const role = String(formData.get("role")) as Role;
  const siteId = formData.get("siteId") ? String(formData.get("siteId")) : null;
  try {
    const result = await provisionUser(
      {
        fullName: String(formData.get("fullName")),
        username: String(formData.get("username")),
        role,
        siteId,
      },
      me.id,
    );
    return {
      ok: `Created ${result.username}. Temp password: ${result.tempPassword} ` +
        `— send via WhatsApp; they must change it on first login.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create employee" };
  }
}
```

- [ ] **Step 2: The Add Employee page (loads sites for the dropdown)**

`src/app/(owner)/owner/employees/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/lib/auth/roles";
import { AddEmployeeForm } from "./form";

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-semibold">Add Employee</h1>
      <AddEmployeeForm sites={sites ?? []} roles={[...ROLES]} />
    </main>
  );
}
```

- [ ] **Step 3: The client form component**

`src/app/(owner)/owner/employees/form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { addEmployee } from "./actions";

export function AddEmployeeForm({
  sites, roles,
}: { sites: { id: string; name: string }[]; roles: string[] }) {
  const [state, action, pending] = useActionState(addEmployee, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input name="fullName" placeholder="Full name" required className="rounded border p-2" />
      <input name="username" placeholder="Username" required className="rounded border p-2" />
      <select name="role" required className="rounded border p-2">
        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <select name="siteId" className="rounded border p-2">
        <option value="">— site (leave blank for owner) —</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
        {pending ? "Creating…" : "Create employee"}
      </button>
    </form>
  );
}
```
(Update the File Structure note: this task also creates `form.tsx` in the same folder.)

- [ ] **Step 4: Build**

```bash
npm run build
```
Expected: owner employees route compiles.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(owner)/owner/employees/"
git commit -m "feat: owner Add Employee screen wired to provisioning"
```

---

## Task 15: Manual end-to-end verification of the foundation

**Files:** none (verification task)

- [ ] **Step 1: Seed an initial owner**

The owner cannot be provisioned through the UI (no owner exists yet). Create a one-off seed script run via service role:
```bash
node --env-file=.env.local -e "
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await a.auth.admin.createUser({ email: 'owner@magneticjoezion.local', password: 'change-me-123', email_confirm: true });
  await a.from('profiles').insert({ id: data.user.id, full_name: 'Owner', username: 'owner', role: 'owner', site_id: null, must_change_password: true });
  console.log('owner seeded: username owner / password change-me-123');
})();
"
```
Expected: prints "owner seeded".

- [ ] **Step 2: Run the dev server**

```bash
npm run dev
```
Expected: server on http://localhost:3000.

- [ ] **Step 3: Walk the flow in a browser**

Verify each, checking output as you go:
- Visiting `/` while logged out redirects to `/login`.
- Logging in as `owner` / `change-me-123` redirects to `/set-password`; after setting a password you land on `/owner`.
- Visiting `/gate` as the owner is allowed (owner can see all).
- At `/owner/employees`, create a `gate` user for Site 1; the temp password is shown.
- Log out, log in as that gate user; first login forces `/set-password`, then lands on `/gate`.
- As the gate user, manually visiting `/owner` or `/accounting` redirects back to `/gate`.

- [ ] **Step 4: Run the full test suite**

```bash
npx supabase db reset && npm run test
```
Expected: all unit + RLS + provisioning tests PASS.

- [ ] **Step 5: Commit any fixes, then tag the phase**

```bash
git add -A && git commit -m "chore: phase 1 foundation verified" || echo "nothing to commit"
git tag phase-1-foundation
```

---

## Self-Review Notes

- **Spec coverage:** §2 (Next.js + Supabase + RLS + server-action privileged ops) → Tasks 1–2, 10, 13. §3 roles (all 7) → Tasks 6, 11. §9 provisioning + email-free username login + forced password change → Tasks 7, 9, 11, 13, 14. Site model → Task 3. The visit workflow, financial model, inventory, dashboard, and PDF (spec §4–§12) are explicitly deferred to Phases 2–6.
- **Out of scope for Phase 1 (by design):** any `visits`, `machines`, `payments`, `stock_movements` tables — those arrive in later phases with their own RLS tests.
- **Type consistency:** `Role`, `ROLE_HOME`, `Profile`, `provisionUser`, `usernameToEmail`/`normalizeUsername` names are used identically across tasks.
- **Note for executor:** Task 14 Step 3 introduces `form.tsx`, which was not listed in the original File Structure block — create it alongside `page.tsx` and `actions.ts`.