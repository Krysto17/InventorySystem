import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// An account entered anywhere is remembered for autofill everywhere — including
// the payment ledger and the payout plan, which the old scrape never saw.
describe("account details are remembered wherever they are entered", () => {
  let siteId: string, supplierId: string, visitId: string, settlementId: string;
  let owner: TestUser, mgr: TestUser, recv: TestUser, keeper: TestUser;
  // Account numbers must be exactly 10 digits (the app's own rule), so an
  // 8-digit tag plus a 2-digit suffix keeps each test's account distinct.
  const tag = String(Date.now()).slice(-8);

  const findAccount = async (number: string) =>
    (await adminClient().from("bank_accounts")
      .select("account_name, account_number, bank_name, times_used")
      .eq("account_number", number).maybeSingle()).data;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "ba-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "ba-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "ba-recv", role: "receiving", siteId });
    keeper = await makeUser({ username: "ba-keeper", role: "stock_keeper", siteId });

    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `BA Supplier ${tag}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: mt!.id,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    visitId = v!.id as string;
    const { data: st } = await adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId, materials_total: 1000, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 1000,
      submitted_by: recv.userId, status: "approved",
    }).select("id").single();
    settlementId = st!.id as string;
  });

  it("remembers an account entered on a supplier", async () => {
    const number = `${tag}01`;
    await adminClient().from("suppliers").update({
      account_name: "Musa Ahmed", account_number: number, bank_name: "Zenith",
    }).eq("id", supplierId);
    const row = await findAccount(number);
    expect(row).not.toBeNull();
    expect(row!.bank_name).toBe("Zenith");
  });

  it("remembers an account entered on an expense", async () => {
    const number = `${tag}02`;
    await adminClient().from("consumables").insert({
      site_id: siteId, name: `Diesel ${tag}`, category: "fuel_lubricants", amount_naira: 5000,
      account_name: "Fuel Depot", account_number: number, bank_name: "GTB",
    });
    expect(await findAccount(number)).not.toBeNull();
  });

  // The two the old three-table scrape never covered.
  it("remembers an account entered while recording a payment", async () => {
    const number = `${tag}03`;
    await adminClient().from("settlement_payments").insert({
      settlement_id: settlementId, site_id: siteId, amount: 500, method: "transfer", paid_by: owner.userId,
      account_name: "Payout Account", account_number: number, bank_name: "UBA",
    });
    const row = await findAccount(number);
    expect(row).not.toBeNull();
    expect(row!.account_name).toBe("Payout Account");
  });

  it("remembers an account entered on a payout split", async () => {
    const number = `${tag}04`;
    await adminClient().from("settlement_payout_splits").insert({
      visit_id: visitId, site_id: siteId, amount: 250,
      account_name: "Split Account", account_number: number, bank_name: "Access",
    });
    expect(await findAccount(number)).not.toBeNull();
  });

  it("keeps one row per account and counts re-use", async () => {
    const number = `${tag}05`;
    for (const name of ["Repeat Payee", "repeat payee"]) {
      await adminClient().from("consumables").insert({
        site_id: siteId, name: `Rent ${tag} ${name}`, category: "others", amount_naira: 100,
        account_name: name, account_number: number, bank_name: "First Bank",
      });
    }
    const { data } = await adminClient().from("bank_accounts")
      .select("id, times_used").eq("account_number", number);
    expect(data).toHaveLength(1); // same number, case-different name = same account
    expect(Number(data![0].times_used)).toBeGreaterThan(1);
  });

  it("never files a half-entered account", async () => {
    const number = `${tag}06`;
    await adminClient().from("consumables").insert({
      site_id: siteId, name: `Partial ${tag}`, category: "others", amount_naira: 100,
      account_name: "No Bank Given", account_number: number, bank_name: null,
    });
    expect(await findAccount(number)).toBeNull();
  });

  it("only the roles that fill account forms can read the directory", async () => {
    expect((await owner.client.from("bank_accounts").select("id")).data!.length).toBeGreaterThan(0);
    expect((await mgr.client.from("bank_accounts").select("id")).data!.length).toBeGreaterThan(0);

    // Receiving and the store keeper have no account form and get nothing.
    expect((await recv.client.from("bank_accounts").select("id")).data ?? []).toHaveLength(0);
    expect((await keeper.client.from("bank_accounts").select("id")).data ?? []).toHaveLength(0);
  });
});
