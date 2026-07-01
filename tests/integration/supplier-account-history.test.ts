import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Manager can rename a supplier (old name kept), and changing account details
// keeps the previous set in former_accounts (history).
describe("supplier rename + account history", () => {
  let mgr: TestUser;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    mgr = await makeUser({ username: "sah-mgr", role: "manager", siteId: site!.id as string });
  });

  it("manager renames a supplier; the old name is kept in former_names", async () => {
    const { data: s } = await adminClient().from("suppliers").insert({ name: `Old Name ${Date.now()}` }).select("id, name").single();
    const { error } = await mgr.client.from("suppliers").update({ name: `New Name ${Date.now()}` }).eq("id", s!.id);
    expect(error).toBeNull();
    const { data: after } = await adminClient().from("suppliers").select("name, former_names").eq("id", s!.id).single();
    expect(after!.name).not.toBe(s!.name);
    expect(after!.former_names).toContain(s!.name);
  });

  it("changing account details keeps the previous account in history", async () => {
    const { data: s } = await adminClient().from("suppliers").insert({ name: `Acct Supplier ${Date.now()}` }).select("id").single();

    // First set — nothing to archive yet.
    await mgr.client.from("suppliers").update({ account_name: "Ada N", account_number: "0011223344", bank_name: "GTB" }).eq("id", s!.id);
    let { data: a } = await adminClient().from("suppliers").select("account_number, former_accounts").eq("id", s!.id).single();
    expect(a!.former_accounts).toHaveLength(0);

    // Change to a new account — the old one is archived.
    await mgr.client.from("suppliers").update({ account_number: "9988776655", bank_name: "Access" }).eq("id", s!.id);
    ({ data: a } = await adminClient().from("suppliers").select("account_number, former_accounts").eq("id", s!.id).single());
    expect(a!.account_number).toBe("9988776655");
    const hist = a!.former_accounts as { account_number?: string }[];
    expect(hist).toHaveLength(1);
    expect(hist[0].account_number).toBe("0011223344");
  });
});
