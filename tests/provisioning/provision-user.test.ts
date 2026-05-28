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
    await admin.from("profiles").insert({
      id: ownerId,
      full_name: "Test Owner",
      username: "test_owner",
      role: "owner",
      site_id: null,
      must_change_password: false,
    });
  });

  it("creates an auth user + profile + setup_code row and returns a temp password", async () => {
    const siteId = await firstSiteId();
    const result = await provisionUser(
      { fullName: "Gate One", username: "gate_one", role: "gate", siteId },
      ownerId,
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
        ownerId,
      ),
    ).rejects.toThrow();
  });
});
