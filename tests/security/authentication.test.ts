import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, anonClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Authentication and account-state gates. Authorization must follow the
// authenticated identity, never anything the client says about itself.
describe("authentication gates", () => {
  let siteId: string, otherSite: string, user: TestUser, owner: TestUser;
  const tag = String(Date.now()).slice(-9);

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    user = await makeUser({ username: `auth-u-${tag}`, role: "receiving", siteId });
    owner = await makeUser({ username: `auth-o-${tag}`, role: "owner", siteId: null });
  });

  it("an unauthenticated caller reads no business data", async () => {
    const anon = anonClient();
    for (const t of ["visits", "batch_settlements", "stock_lots", "advances", "consumables"]) {
      const { data } = await anon.from(t).select("id").limit(1);
      expect(data ?? [], `anon should read nothing from ${t}`).toHaveLength(0);
    }
  });

  it("a disabled account keeps its data but loses its access path", async () => {
    const victim = await makeUser({ username: `auth-dis-${tag}`, role: "receiving", siteId });
    await adminClient().from("profiles").update({ status: "disabled" }).eq("id", victim.userId);
    // The profile row still exists — disabling preserves history, it does not delete.
    const { data } = await adminClient().from("profiles").select("status").eq("id", victim.userId).single();
    expect(data!.status).toBe("disabled");
    // A disabled user cannot re-enable themselves.
    const res = await victim.client.from("profiles").update({ status: "active" }).eq("id", victim.userId);
    expect(res.error).not.toBeNull();
    const after = await adminClient().from("profiles").select("status").eq("id", victim.userId).single();
    expect(after.data!.status).toBe("disabled");
  });

  it("authorization follows the session, not a site the caller claims", async () => {
    // Writing a row stamped with another site must fail however it is asked for.
    const { data: sup } = await adminClient().from("suppliers")
      .insert({ name: `Auth ${tag}` }).select("id").single();
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    const res = await user.client.from("visits").insert({
      site_id: otherSite,                 // a site this user is not posted to
      supplier_id: sup!.id, declared_material_type_id: mt!.id,
      entry_path: "processed", state: "in_receiving", created_by: user.userId,
    }).select("id");
    expect(!res.error && (res.data ?? []).length > 0).toBe(false);
  });

  it("authorization follows the session, not a created_by the caller claims", async () => {
    // Claiming to be the owner in a column does not confer the owner's rights.
    const { data: sup } = await adminClient().from("suppliers")
      .insert({ name: `Auth2 ${tag}` }).select("id").single();
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    const res = await user.client.from("visits").insert({
      site_id: otherSite, supplier_id: sup!.id, declared_material_type_id: mt!.id,
      entry_path: "processed", state: "in_receiving",
      created_by: owner.userId,           // someone else's identity
    }).select("id");
    expect(!res.error && (res.data ?? []).length > 0).toBe(false);
  });

  it("must_change_password is a profile fact the user may clear only for themselves", async () => {
    const fresh = await makeUser({ username: `auth-mcp-${tag}`, role: "receiving", siteId });
    await adminClient().from("profiles").update({ must_change_password: true }).eq("id", fresh.userId);

    // Their own flag: allowed (this is what the set-password flow does).
    expect((await fresh.client.from("profiles")
      .update({ must_change_password: false }).eq("id", fresh.userId)).error).toBeNull();

    // Someone else's: refused.
    await adminClient().from("profiles").update({ must_change_password: true }).eq("id", user.userId);
    await fresh.client.from("profiles").update({ must_change_password: false }).eq("id", user.userId);
    const { data } = await adminClient().from("profiles")
      .select("must_change_password").eq("id", user.userId).single();
    expect(data!.must_change_password).toBe(true);
  });
});
