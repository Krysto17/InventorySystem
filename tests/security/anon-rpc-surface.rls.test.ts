import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, anonClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * L-1: the reporting RPCs must not answer an unauthenticated caller.
 *
 * Eight SECURITY DEFINER functions were executable by `anon`. Because a definer
 * answers with its own privileges, RLS never applied — so the table-level cover
 * in anonymous-access.test.ts passed while the same data walked out through a
 * function. That file guards tables; this one guards the RPC surface, which is
 * the gap L-1 came through.
 *
 * The worst of them, find_similar_suppliers, takes a NAME rather than an id, so
 * an anonymous caller needed to know nothing at all to enumerate suppliers —
 * account_name, account_number and bank_name included.
 */

// Everything that was anon-executable. All eight must refuse anon; the second
// column says whether a signed-in user may still call it.
const RPCS: { fn: string; args: Record<string, unknown>; authenticated: boolean }[] = [
  { fn: "find_similar_suppliers", args: { p_name: "x", p_account_number: null, p_exclude: null }, authenticated: true },
  { fn: "supplier_outstanding_debt", args: { _supplier_id: "00000000-0000-0000-0000-000000000000" }, authenticated: true },
  { fn: "supplier_processing_debt", args: { _supplier_id: "00000000-0000-0000-0000-000000000000" }, authenticated: true },
  { fn: "settlement_totals", args: { p_visit_id: "00000000-0000-0000-0000-000000000000" }, authenticated: true },
  { fn: "settlement_paid_total", args: { p_settlement_id: "00000000-0000-0000-0000-000000000000" }, authenticated: true },
  // Evaluated by eight RLS policies, so signed-in users must keep it.
  { fn: "visit_is_open", args: { _visit_id: "00000000-0000-0000-0000-000000000000" }, authenticated: true },
  // Reachable from nowhere — no caller, no policy, no view. Nobody needs it.
  { fn: "supplier_carried_light_bills", args: { _supplier_id: "00000000-0000-0000-0000-000000000000" }, authenticated: false },
  { fn: "pricing_has_acted", args: { _visit_id: "00000000-0000-0000-0000-000000000000" }, authenticated: false },
];

/**
 * A refusal has to be a REFUSAL, not the database being unreachable.
 *
 * If Supabase is down every call "fails" and a naive `expect(error).not.toBeNull()`
 * passes for entirely the wrong reason — the suite would report the hole closed
 * while it stood open. Postgres answers a missing EXECUTE grant with SQLSTATE
 * 42501, and PostgREST forwards that; a transport failure carries no such code.
 */
function assertDeniedNotBroken(
  res: { data: unknown; error: { code?: string; message?: string } | null },
  fn: string,
) {
  expect(res.error, `anon executed ${fn} — the anonymous hole is open`).not.toBeNull();
  const code = res.error?.code ?? "";
  const message = res.error?.message ?? "";
  expect(
    /fetch failed|network|ECONNREFUSED|socket|aborted/i.test(message),
    `${fn}: the call failed at the transport, so this proves nothing — is the stack running?`,
  ).toBe(false);
  expect(
    code === "42501" || /permission denied|not allowed|does not exist/i.test(message),
    `${fn}: refused, but not for a privilege reason (code=${code} message=${message})`,
  ).toBe(true);
}

describe("anonymous RPC surface", () => {
  let user: TestUser;
  let supplierName: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    // Deliberately the LEAST privileged role that can sign in, to prove the
    // grant is what admits the caller, not their seniority.
    user = await makeUser({ username: `anonrpc-${Date.now()}`, role: "processing", siteId });

    supplierName = `AnonProbe ${Date.now()}`;
    await adminClient().from("suppliers").insert({
      name: supplierName,
      account_name: "Probe Account",
      account_number: "0123456789",
      bank_name: "Probe Bank",
    });
  });

  // ── A. anon is refused, on every one of them ──────────────────────────────
  for (const { fn, args } of RPCS) {
    it(`anon cannot execute ${fn}`, async () => {
      const res = await anonClient().rpc(fn, args as never);
      assertDeniedNotBroken(res as never, fn);
    });
  }

  // ── The original attack path, end to end ──────────────────────────────────
  it("anon cannot enumerate the supplier directory by name", async () => {
    const res = await anonClient().rpc("find_similar_suppliers", {
      p_name: supplierName, p_account_number: null, p_exclude: null,
    } as never);
    assertDeniedNotBroken(res as never, "find_similar_suppliers");
    // Belt and braces: whatever happened, no supplier row came back.
    expect((res.data as unknown[] | null) ?? []).toHaveLength(0);
  });

  it("anon cannot find a supplier by account number either", async () => {
    const res = await anonClient().rpc("find_similar_suppliers", {
      p_name: null, p_account_number: "0123456789", p_exclude: null,
    } as never);
    assertDeniedNotBroken(res as never, "find_similar_suppliers");
    expect((res.data as unknown[] | null) ?? []).toHaveLength(0);
  });

  it("and cannot reach the debt figures it used to chain into", async () => {
    const { data: sup } = await adminClient()
      .from("suppliers").select("id").eq("name", supplierName).single();
    for (const fn of ["supplier_outstanding_debt", "supplier_processing_debt"]) {
      const res = await anonClient().rpc(fn, { _supplier_id: sup!.id } as never);
      assertDeniedNotBroken(res as never, fn);
    }
  });

  // ── B. the legitimate signed-in workflow still works ──────────────────────
  for (const { fn, args, authenticated } of RPCS.filter((r) => r.authenticated)) {
    it(`a signed-in user may still execute ${fn}`, async () => {
      expect(authenticated).toBe(true);
      const { error } = await user.client.rpc(fn, args as never);
      expect(error, `${fn} must remain callable while signed in: ${error?.message}`).toBeNull();
    });
  }

  it("the duplicate-supplier search still finds a supplier for a signed-in user", async () => {
    const { data, error } = await user.client.rpc("find_similar_suppliers", {
      p_name: supplierName, p_account_number: null, p_exclude: null,
    } as never);
    expect(error).toBeNull();
    expect((data as unknown[] | null) ?? []).not.toHaveLength(0);
  });

  // ── The two nobody calls are closed to signed-in users as well ────────────
  for (const { fn, args } of RPCS.filter((r) => !r.authenticated)) {
    it(`${fn} is reachable from nowhere, so nobody may execute it`, async () => {
      const res = await user.client.rpc(fn, args as never);
      assertDeniedNotBroken(res as never, fn);
    });
  }

  // ── C/D. cross-role and cross-site ────────────────────────────────────────
  //
  // No cross-ROLE assertion is made for the supplier functions, and that is a
  // finding rather than an omission: the RLS SELECT policy on `suppliers` is
  // `using (true)` for authenticated, so every signed-in role can already read
  // account_name/account_number/bank_name straight from the table. A test
  // asserting otherwise would be asserting something untrue. Narrowing that is
  // a separate decision about the supplier directory, recorded as a follow-up.
  //
  // What IS worth pinning is that the boundary this migration draws is exactly
  // "signed in or not" — so a second site's user is admitted on the same terms.
  it("the boundary is authentication, not site — a second site's user is admitted alike", async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const other = sites!.find((s) => s.name === "New-Site")!.id as string;
    const elsewhere = await makeUser({ username: `anonrpc2-${Date.now()}`, role: "receiving", siteId: other });
    const { error } = await elsewhere.client.rpc("find_similar_suppliers", {
      p_name: supplierName, p_account_number: null, p_exclude: null,
    } as never);
    expect(error).toBeNull();
  });
});
