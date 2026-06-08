import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, firstSiteId } from "../setup/supabase-test-clients";
import { provisionUser } from "@/lib/provisioning/provision-user";

let ownerId: string;

describe("provisionUser", () => {
  beforeAll(async () => {
    const admin = adminClient();
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of existing.users) await admin.auth.admin.deleteUser(u.id);

    // Create a real owner whose id we can use as created_by in tests.
    const { data, error } = await admin.auth.admin.createUser({
      email: "test-owner@magneticjoezion.local",
      password: "test-password-123",
      email_confirm: true,
    });
    if (error) throw error;
    ownerId = data.user!.id;
    const { error: ownerProfErr } = await admin.from("profiles").insert({
      id: ownerId,
      full_name: "Test Owner",
      username: "test_owner",
      role: "owner",
      site_id: null,
      must_change_password: false,
    });
    if (ownerProfErr) throw ownerProfErr;
  });

  it("creates an auth user + profile + setup_code row and returns a temp password", async () => {
    const siteId = await firstSiteId();
    const result = await provisionUser(
      { fullName: "Recv One", username: "recv_one", role: "receiving", siteId },
      ownerId,
    );
    expect(result.tempPassword).toHaveLength(12);

    const admin = adminClient();
    const { data: profile } = await admin.from("profiles")
      .select("*").eq("username", "recv_one").single();
    expect(profile?.role).toBe("receiving");
    expect(profile?.must_change_password).toBe(true);

    const { data: codes } = await admin.from("setup_codes")
      .select("*").eq("username", "recv_one");
    expect(codes).toHaveLength(1);
  });

  it("rejects a duplicate username", async () => {
    const siteId = await firstSiteId();
    await expect(
      provisionUser(
        { fullName: "Dupe", username: "recv_one", role: "receiving", siteId },
        ownerId,
      ),
    ).rejects.toThrow();
  });

  it("rolls back the auth user when the profile insert fails", async () => {
    const siteId = await firstSiteId();
    const admin = adminClient();

    // Pre-create a profile row with the username we'll attempt to provision.
    // We attach it to an existing user (the test owner) so the FK is satisfied,
    // and use a different real auth user for the username so the
    // username UNIQUE constraint fires when provisionUser tries to insert.
    // The simplest way: pre-create a *fake* auth user that holds the username,
    // then call provisionUser with the same username but a different (synthetic)
    // email. Since our usernameToEmail mapping is deterministic, the only way to
    // get createUser to succeed with the same username is to first delete the
    // colliding auth user but leave the profile. So:
    //
    //   step a: create a "ghost" auth user
    //   step b: insert a profile row with that ghost id and username = "ghost_collide"
    //   step c: delete the ghost auth user via the admin API. This cascades to
    //           the profile row (due to ON DELETE CASCADE), so this approach won't
    //           work as written.
    //
    // Alternative simpler approach: seed a profile directly with a random uuid that
    // satisfies the auth.users FK by reusing the test owner's id is impossible
    // because (id, username) PK requires unique id too. Use a separate auth user.

    // Simplest reliable plan:
    //   1. createUser for "collider@magneticjoezion.local" via admin.
    //   2. Insert profile with that user id and username "collide_user".
    //   3. Now call provisionUser({ username: "collide_user", ... }). usernameToEmail
    //      returns "collide_user@magneticjoezion.local" — a DIFFERENT email — so
    //      auth.createUser succeeds. Then the profile insert tries to use the same
    //      username, hits the UNIQUE constraint, fails, triggers rollback. We then
    //      verify that the newly-created auth user (with the new email) has been
    //      deleted by checking listUsers does not contain it.

    const { data: pre } = await admin.auth.admin.createUser({
      email: "collider@magneticjoezion.local",
      password: "test-password-123",
      email_confirm: true,
    });
    const preId = pre.user!.id;
    await admin.from("profiles").insert({
      id: preId,
      full_name: "Collider",
      username: "collide_user",
      role: "receiving",
      site_id: siteId,
      must_change_password: false,
    });

    // Now try to provision with the same username but a different synthetic email.
    await expect(
      provisionUser(
        { fullName: "Will Roll Back", username: "collide_user", role: "receiving", siteId },
        ownerId,
      ),
    ).rejects.toThrow();

    // The auth user that provisionUser CREATED (email collide_user@...) must have
    // been deleted by rollback. The pre-existing "collider@..." user must still exist.
    const { data: after } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const emails = after.users.map((u) => u.email);
    expect(emails).toContain("collider@magneticjoezion.local");
    expect(emails).not.toContain("collide_user@magneticjoezion.local");
  });
});
