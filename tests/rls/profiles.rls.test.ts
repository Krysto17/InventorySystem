import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, makeUser, firstSiteId } from "../setup/supabase-test-clients";

describe("profiles RLS", () => {
  beforeAll(async () => {
    // Clean slate for auth users + profiles between runs.
    const admin = adminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data.users) await admin.auth.admin.deleteUser(u.id);
  });

  it("a user can read their own profile", async () => {
    const siteId = await firstSiteId();
    const { client, id } = await makeUser({ username: "gate1", role: "receiving", siteId });
    const { data, error } = await client.from("profiles").select("*").eq("id", id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("a non-owner cannot read another user's profile", async () => {
    const siteId = await firstSiteId();
    const a = await makeUser({ username: "gate2", role: "receiving", siteId });
    const b = await makeUser({ username: "acct2", role: "accounting", siteId });
    const { data } = await a.client.from("profiles").select("*").eq("id", b.id);
    expect(data).toHaveLength(0); // RLS filters it out, not an error
  });

  it("the owner can read every profile", async () => {
    const siteId = await firstSiteId();
    await makeUser({ username: "gate3", role: "receiving", siteId });
    const owner = await makeUser({ username: "owner1", role: "owner", siteId: null });
    const { data } = await owner.client.from("profiles").select("*");
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("a user can clear their own must_change_password", async () => {
    const siteId = await firstSiteId();
    const { client, id } = await makeUser({ username: "gate_upd", role: "receiving", siteId });
    // Seed must_change_password = true via admin so the user update is a real write.
    const admin = adminClient();
    await admin.from("profiles").update({ must_change_password: true }).eq("id", id);
    const { error } = await client.from("profiles")
      .update({ must_change_password: false }).eq("id", id);
    expect(error).toBeNull();
    const { data } = await admin.from("profiles").select("must_change_password").eq("id", id).single();
    expect(data?.must_change_password).toBe(false);
  });

  it("a user cannot promote themselves to owner", async () => {
    const siteId = await firstSiteId();
    const { client, id } = await makeUser({ username: "esc_attempt", role: "receiving", siteId });
    // Try escalating to "manager" — no CHECK constraint blocks this, so before the
    // column-privilege REVOKE this update would silently succeed, proving the hole.
    // After the REVOKE, PostgREST returns a permission denied error and role stays "receiving".
    const { error } = await client.from("profiles")
      .update({ role: "manager" }).eq("id", id);
    // We assert role did NOT change, regardless of whether the API returned an error.
    const admin = adminClient();
    const { data } = await admin.from("profiles").select("role").eq("id", id).single();
    expect(data?.role).toBe("receiving");
    // After the column-privilege REVOKE, an error is expected.
    expect(error).not.toBeNull();
  });
});
