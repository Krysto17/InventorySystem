import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, anonClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Regression cover for the Phase 1 remediation. Each test names the audit
// finding it protects, so a change that reopens one fails here.
describe("Phase 1 security hardening", () => {
  let user: TestUser, owner: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    user = await makeUser({ username: `p1-${Date.now()}`, role: "receiving", siteId });
    owner = await makeUser({ username: `p1o-${Date.now()}`, role: "owner", siteId: null });
  });

  // M-06
  it("an ordinary user cannot call the internal cost-price recompute", async () => {
    const { error } = await user.client.rpc("_recompute_cost_price_run", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).not.toBeNull();
  });

  it("but the trigger that depends on it still recomputes", async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    const { data: run } = await adminClient().from("cost_price_runs")
      .insert({ site_id: site!.id, label: `Recompute ${Date.now()}`, created_by: owner.userId })
      .select("id").single();
    const extra = await adminClient().from("cost_price_run_extras").insert({
      run_id: run!.id, material_name: "External ore", weight_kg: 10, cost_price_per_kg: 500,
    });
    expect(extra.error).toBeNull();
    const { data: after } = await adminClient().from("cost_price_runs")
      .select("total_weight_kg, total_cost_price").eq("id", run!.id).single();
    expect(Number(after!.total_weight_kg)).toBe(10);
    expect(Number(after!.total_cost_price)).toBe(5000);
  });

  // L-02
  it("a user cannot insert or delete profile rows", async () => {
    const ins = await user.client.from("profiles").insert({
      id: crypto.randomUUID(), full_name: "x", username: `x${Date.now()}`, role: "owner",
    } as never);
    expect(ins.error).not.toBeNull();
    await user.client.from("profiles").delete().eq("id", user.userId);
    expect((await adminClient().from("profiles").select("id").eq("id", user.userId)).data!).toHaveLength(1);
  });

  it("still cannot rewrite their own role, but can clear must_change_password", async () => {
    expect((await user.client.from("profiles").update({ role: "owner" }).eq("id", user.userId)).error).not.toBeNull();
    expect((await user.client.from("profiles").update({ must_change_password: false }).eq("id", user.userId)).error).toBeNull();
  });

  // L-01
  it("anonymous callers read nothing from profiles or setup codes", async () => {
    const anon = anonClient();
    expect((await anon.from("profiles").select("id")).data ?? []).toHaveLength(0);
    expect((await anon.from("setup_codes").select("id")).data ?? []).toHaveLength(0);
  });

  // L-02b. The grants were revoked as well as the policies retargeted, so an
  // anonymous caller is now refused by the privilege system BEFORE RLS is
  // consulted. Asserting the error — not just an empty result — is what
  // distinguishes "no grant" from "a policy that happens to match nothing".
  it("anonymous callers hold no privilege on profiles at all", async () => {
    const anon = anonClient();
    const read = await anon.from("profiles").select("id");
    expect(read.error, "anon should be refused, not merely filtered").not.toBeNull();

    const ins = await anon.from("profiles").insert({
      id: crypto.randomUUID(), full_name: "x", username: `anon${Date.now()}`, role: "owner",
    } as never);
    expect(ins.error).not.toBeNull();
    expect((await anon.from("profiles").update({ role: "owner" }).eq("id", user.userId)).error).not.toBeNull();
    expect((await anon.from("profiles").delete().eq("id", user.userId)).error).not.toBeNull();

    // The account is still there — nothing above half-succeeded.
    expect((await adminClient().from("profiles").select("id").eq("id", user.userId)).data!).toHaveLength(1);
  });

  // F-6. Housekeeping is not a browser-reachable routine.
  it("an anonymous caller cannot invoke the throttle prune at all", async () => {
    const { error } = await anonClient().rpc("prune_auth_throttle");
    expect(error).not.toBeNull();
  });

  it("and a signed-in non-owner is still refused by the owner check", async () => {
    const { error } = await user.client.rpc("prune_auth_throttle");
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only the owner/i);
  });

  it("but the owner can run it", async () => {
    const { error } = await owner.client.rpc("prune_auth_throttle");
    expect(error).toBeNull();
  });

  // H-03. The throttle is invoked by the sign-in action with the service-role
  // client; these drive it the same way.
  it("repeated failures earn a growing wait, capped — never a lockout", async () => {
    const bucket = [`user:throttle-${Date.now()}`];
    const anon = adminClient();
    expect(Number((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).data ?? 0)).toBe(0);

    for (let i = 0; i < 3; i++) await anon.rpc("auth_throttle_fail", { p_buckets: bucket });
    expect(Number((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).data ?? 0)).toBe(0);

    for (let i = 0; i < 3; i++) await anon.rpc("auth_throttle_fail", { p_buckets: bucket });
    const first = Number((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).data ?? 0);
    expect(first).toBeGreaterThan(0);

    for (let i = 0; i < 20; i++) await anon.rpc("auth_throttle_fail", { p_buckets: bucket });
    const capped = Number((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).data ?? 0);
    expect(capped).toBeGreaterThanOrEqual(first);
    expect(capped).toBeLessThanOrEqual(120);
  });

  it("a successful sign-in clears the counter", async () => {
    const bucket = [`user:clear-${Date.now()}`];
    const anon = adminClient();
    for (let i = 0; i < 8; i++) await anon.rpc("auth_throttle_fail", { p_buckets: bucket });
    expect(Number((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).data ?? 0)).toBeGreaterThan(0);
    await anon.rpc("auth_throttle_clear", { p_buckets: bucket });
    expect(Number((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).data ?? 0)).toBe(0);
  });

  // The control is only worth having if it cannot be switched off or turned on
  // someone else from the browser.
  it("the browser cannot reach the throttle functions at all", async () => {
    const anon = anonClient();
    const bucket = [`user:reach-${Date.now()}`];
    expect((await anon.rpc("auth_throttle_check", { p_buckets: bucket })).error).not.toBeNull();
    expect((await anon.rpc("auth_throttle_fail",  { p_buckets: bucket })).error).not.toBeNull();
    expect((await anon.rpc("auth_throttle_clear", { p_buckets: bucket })).error).not.toBeNull();
    // Nor can a signed-in user clear their own, or inflate anyone else's.
    expect((await user.client.rpc("auth_throttle_clear", { p_buckets: bucket })).error).not.toBeNull();
    expect((await user.client.rpc("auth_throttle_fail",  { p_buckets: bucket })).error).not.toBeNull();
  });

  it("nobody can read the throttle table itself", async () => {
    expect((await user.client.from("auth_throttle").select("bucket")).data ?? []).toHaveLength(0);
    expect((await owner.client.from("auth_throttle").select("bucket")).data ?? []).toHaveLength(0);
  });
});
