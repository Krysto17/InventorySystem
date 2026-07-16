import { describe, it, expect } from "vitest";
import { adminClient } from "../setup/supabase-test-clients";

// Switching a supplier's account archives the old one and de-duplicates the
// promoted account out of history.
describe("supplier account switch + history", () => {
  const A = { account_name: "Ada A", account_number: "0111111111", bank_name: "GTB" };
  const B = { account_name: "Ben B", account_number: "0222222222", bank_name: "UBA" };

  it("switching back to a former account keeps history clean", async () => {
    const { data: s } = await adminClient().from("suppliers").insert({ name: `Sw ${Date.now()}`, ...A }).select("id").single();
    const id = s!.id as string;

    // Change to B → A is archived.
    await adminClient().from("suppliers").update(B).eq("id", id);
    let row = (await adminClient().from("suppliers").select("account_number, former_accounts").eq("id", id).single()).data!;
    expect(row.account_number).toBe(B.account_number);
    let formers = row.former_accounts as { account_number: string }[];
    expect(formers.map((f) => f.account_number)).toEqual([A.account_number]);

    // Switch back to A → B archived, A removed from history (now current).
    await adminClient().from("suppliers").update(A).eq("id", id);
    row = (await adminClient().from("suppliers").select("account_number, former_accounts").eq("id", id).single()).data!;
    expect(row.account_number).toBe(A.account_number);
    formers = row.former_accounts as { account_number: string }[];
    expect(formers.map((f) => f.account_number)).toEqual([B.account_number]);
    expect(formers.some((f) => f.account_number === A.account_number)).toBe(false);
  });
});
