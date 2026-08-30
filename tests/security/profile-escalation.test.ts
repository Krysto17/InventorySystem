import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The escalation attempts the audit ran by hand, made permanent. Every one of
// these must stay denied; none may be "fixed" by relaxing a policy.
describe("privilege escalation is refused", () => {
  let low: TestUser, other: TestUser, siteId: string, otherSite: string;
  const tag = String(Date.now()).slice(-9);

  const roleOf = async (id: string) =>
    (await adminClient().from("profiles").select("role, site_id, status").eq("id", id).single()).data!;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    low = await makeUser({ username: `esc-low-${tag}`, role: "receiving", siteId });
    other = await makeUser({ username: `esc-oth-${tag}`, role: "qc", siteId });
  });

  it("cannot change its own role", async () => {
    await low.client.from("profiles").update({ role: "owner" }).eq("id", low.userId);
    expect((await roleOf(low.userId)).role).toBe("receiving");
  });

  it("cannot change its own site", async () => {
    await low.client.from("profiles").update({ site_id: otherSite }).eq("id", low.userId);
    expect((await roleOf(low.userId)).site_id).toBe(siteId);
  });

  it("cannot activate a disabled account", async () => {
    await adminClient().from("profiles").update({ status: "disabled" }).eq("id", low.userId);
    await low.client.from("profiles").update({ status: "active" }).eq("id", low.userId);
    expect((await roleOf(low.userId)).status).toBe("disabled");
    await adminClient().from("profiles").update({ status: "active" }).eq("id", low.userId);
  });

  it("cannot create any profile, least of all an owner", async () => {
    const before = (await adminClient().from("profiles").select("id", { count: "exact", head: true })).count;
    await low.client.from("profiles").insert({
      id: crypto.randomUUID(), full_name: "Intruder", username: `intruder-${tag}`, role: "owner",
    } as never);
    const after = (await adminClient().from("profiles").select("id", { count: "exact", head: true })).count;
    expect(after).toBe(before);
  });

  it("cannot delete its own profile", async () => {
    await low.client.from("profiles").delete().eq("id", low.userId);
    expect((await adminClient().from("profiles").select("id").eq("id", low.userId)).data!).toHaveLength(1);
  });

  it("cannot read or modify another user's profile", async () => {
    expect((await low.client.from("profiles").select("id").eq("id", other.userId)).data ?? []).toHaveLength(0);
    await low.client.from("profiles").update({ role: "processing" }).eq("id", other.userId);
    expect((await roleOf(other.userId)).role).toBe("qc");
  });
});
