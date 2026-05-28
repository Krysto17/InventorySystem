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
