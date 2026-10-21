import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// 0167/0168. A supplier carrying an advance could not be merged at all: three
// separate guards stood in the way (a paid advance is immutable, an approved
// one's supplier_id is frozen by ST002, and advance_shares was never reassigned
// so the final delete hit a foreign key). Merging such a supplier has to move
// the DEBT faithfully, which is the real content of these tests.
describe("merging suppliers that carry advances (0167)", () => {
  let siteId: string, monazite: string;
  let owner: TestUser, gm: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    const newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    owner = await makeUser({ username: "mwa-owner", role: "owner", siteId: null });
    gm = await makeUser({ username: "mwa-gm", role: "manager", siteId: newSite });
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  const mkSupplier = async (name: string) =>
    (await adminClient().from("suppliers").insert({ name }).select("id").single()).data!.id as string;

  const mkPaidAdvance = async (supplierId: string, amount: number, purpose: string) =>
    (await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose, amount_naira: amount, approval_status: "paid",
    }).select("id").single()).data!.id as string;

  const debtOf = async (supplierId: string) =>
    Number((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId } as never)).data ?? 0);

  it("merges a supplier whose advance has already been PAID", async () => {
    const stamp = Date.now();
    const keep = await mkSupplier(`Paidadv Keep ${stamp}`);
    const dupe = await mkSupplier(`Paidadv Dupe ${stamp}`);
    await mkPaidAdvance(dupe, 50_000, `PA ${stamp}`);

    const { error } = await owner.client.rpc("merge_suppliers", { p_keep: keep, p_duplicate: dupe });
    expect(error, error?.message).toBeNull();

    expect(await debtOf(keep)).toBe(50_000);
    expect((await adminClient().from("suppliers").select("id").eq("id", dupe).maybeSingle()).data).toBeNull();
  });

  it("preserves total debt across all four advance-share cases", async () => {
    const stamp = Date.now();
    const keep = await mkSupplier(`Shares Keep ${stamp}`);
    const dupe = await mkSupplier(`Shares Dupe ${stamp}`);
    const third = await mkSupplier(`Shares Third ${stamp}`);

    // (1) keep collected, dupe holds a share
    const a1 = await mkPaidAdvance(keep, 1000, `S1 ${stamp}`);
    // (2) dupe collected, keep holds a share
    const a2 = await mkPaidAdvance(dupe, 1000, `S2 ${stamp}`);
    // (3) third collected, BOTH hold a share (unique (advance_id, supplier_id))
    const a3 = await mkPaidAdvance(third, 1000, `S3 ${stamp}`);
    // (4) third collected, only dupe holds a share
    const a4 = await mkPaidAdvance(third, 1000, `S4 ${stamp}`);

    for (const row of [
      { advance_id: a1, supplier_id: dupe, amount: 300 },
      { advance_id: a2, supplier_id: keep, amount: 400 },
      { advance_id: a3, supplier_id: keep, amount: 200 },
      { advance_id: a3, supplier_id: dupe, amount: 100 },
      { advance_id: a4, supplier_id: dupe, amount: 250 },
    ]) {
      const { error } = await adminClient().from("advance_shares").insert(row).select("id");
      expect(error, JSON.stringify(row)).toBeNull();
    }

    const before = { keep: await debtOf(keep), dupe: await debtOf(dupe), third: await debtOf(third) };
    expect(before.keep).toBe(1300);  // 700 remainder + 400 + 200
    expect(before.dupe).toBe(1250);  // 600 remainder + 300 + 100 + 250

    const { error } = await owner.client.rpc("merge_suppliers", { p_keep: keep, p_duplicate: dupe });
    expect(error, error?.message).toBeNull();

    // No money created or destroyed, and the third party is untouched.
    expect(await debtOf(keep)).toBe(before.keep + before.dupe);
    expect(await debtOf(third)).toBe(before.third);

    // Nobody ends up holding a share of an advance they collected themselves —
    // the state _advance_shares_guard exists to prevent.
    const { data: selfShares } = await adminClient()
      .from("advance_shares").select("advance_id, supplier_id, advance:advances(supplier_id)")
      .in("advance_id", [a1, a2, a3, a4]);
    for (const sh of selfShares ?? []) {
      const adv = (sh as unknown as { advance: { supplier_id: string } | { supplier_id: string }[] }).advance;
      const collector = Array.isArray(adv) ? adv[0]?.supplier_id : adv?.supplier_id;
      expect(sh.supplier_id).not.toBe(collector);
    }
  });

  it("still refuses to change a paid advance outside a merge", async () => {
    const stamp = Date.now();
    const a = await mkSupplier(`Frozen A ${stamp}`);
    const b = await mkSupplier(`Frozen B ${stamp}`);
    const adv = await mkPaidAdvance(a, 1000, `FZ ${stamp}`);

    const res = await adminClient().from("advances")
      .update({ supplier_id: b }).eq("id", adv).select("id");
    expect(res.error, "a paid advance must stay immutable outside a merge").not.toBeNull();
    expect((await adminClient().from("advances").select("supplier_id").eq("id", adv).single()).data!.supplier_id).toBe(a);
  });

  it("a site manager still cannot merge, advances or not", async () => {
    const stamp = Date.now();
    const keep = await mkSupplier(`Noauth Keep ${stamp}`);
    const dupe = await mkSupplier(`Noauth Dupe ${stamp}`);
    await mkPaidAdvance(dupe, 1000, `NA ${stamp}`);
    const mgr = await makeUser({ username: "mwa-sm", role: "manager", siteId });
    expect((await mgr.client.rpc("merge_suppliers", { p_keep: keep, p_duplicate: dupe })).error).not.toBeNull();
    expect((await adminClient().from("suppliers").select("id").eq("id", dupe).maybeSingle()).data).not.toBeNull();
  });

  it("the merge also moves visits and lots belonging to the advance holder", async () => {
    const stamp = Date.now();
    const keep = await mkSupplier(`Mixed Keep ${stamp}`);
    const dupe = await mkSupplier(`Mixed Dupe ${stamp}`);
    await mkPaidAdvance(dupe, 1000, `MX ${stamp}`);
    const { data: lot } = await adminClient().from("stock_lots").insert({
      site_id: siteId, material_type_id: monazite, supplier_id: dupe,
      weight_kg: 10, cost_price_per_kg: 5, recorded_by: owner.userId,
    }).select("id").single();

    expect((await gm.client.rpc("merge_suppliers", { p_keep: keep, p_duplicate: dupe })).error).toBeNull();
    expect((await adminClient().from("stock_lots").select("supplier_id").eq("id", lot!.id).single()).data!.supplier_id).toBe(keep);
  });
});

// 0167 also widened candidate search, and 0168 normalised the stored name.
describe("finding a duplicate by any name the supplier has had (0167/0168)", () => {
  let gm: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    const newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    gm = await makeUser({ username: "fsn-gm", role: "manager", siteId: newSite });
  });

  it("finds a supplier by a name it used to have", async () => {
    const stamp = Date.now();
    const oldName = `Musa Ahmed ${stamp}`;
    const { data: s } = await adminClient().from("suppliers").insert({ name: oldName }).select("id").single();
    await adminClient().from("suppliers").update({ name: `Ahmed Musa ${stamp}` }).eq("id", s!.id);

    // Searching the name on the OLD paperwork used to find nothing: only
    // `suppliers.name` was compared, never `former_names`.
    const { data } = await gm.client.rpc("find_similar_suppliers", { p_name: oldName } as never);
    expect((data ?? []).some((r: { id: string }) => r.id === s!.id)).toBe(true);
  });

  it("finds the Madam Maria / Maria Dung pair on a shared word", async () => {
    const stamp = Date.now();
    const tag = `Zmaria${stamp}`;
    const { data: a } = await adminClient().from("suppliers").insert({ name: `Madam ${tag}` }).select("id").single();
    const { data: b } = await adminClient().from("suppliers").insert({ name: `${tag} Dung` }).select("id").single();

    const { data } = await gm.client.rpc("find_similar_suppliers", {
      p_name: `${tag} Dung`, p_exclude: b!.id,
    } as never);
    expect((data ?? []).some((r: { id: string }) => r.id === a!.id)).toBe(true);
  });

  it("does not match everyone on a short word", async () => {
    const { data } = await gm.client.rpc("find_similar_suppliers", { p_name: "Ltd" } as never);
    // "Ltd" is three letters, below the 4-letter floor, so it is not a signal.
    expect((data ?? []).length).toBe(0);
  });

  it("stores names in Title Case but keeps deliberate inner capitals", async () => {
    const stamp = Date.now();
    const cases: [string, string][] = [
      [`AHMED MUSA ${stamp}`, `Ahmed Musa ${stamp}`],
      [`ahmed musa b${stamp}`, `Ahmed Musa B${stamp}`],
      [`  McDonald   Farms ${stamp}  `, `McDonald Farms ${stamp}`],
      [`DeSouza Ltd ${stamp}`, `DeSouza Ltd ${stamp}`],
      // Postgres initcap would mangle these: "A.A." -> "A.a.". Real supplier
      // names, so the rule leaves any word with a full stop or apostrophe alone.
      [`A.A. Shatima ${stamp}`, `A.A. Shatima ${stamp}`],
      [`A.A.F mining ${stamp}`, `A.A.F Mining ${stamp}`],
      // Whitespace runs collapse, which is what makes a double-spaced name
      // findable by typing it as it looks.
      [`Lucky  Elisha ${stamp}`, `Lucky Elisha ${stamp}`],
    ];
    for (const [typed, stored] of cases) {
      const { data } = await adminClient().from("suppliers").insert({ name: typed }).select("name").single();
      expect(data!.name, `typed: ${typed}`).toBe(stored);
    }
  });

  it("re-casing a name is not a rename, so it leaves no history", async () => {
    const stamp = Date.now();
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `Casing Probe ${stamp}` }).select("id").single();
    await adminClient().from("suppliers").update({ name: `CASING PROBE ${stamp}` }).eq("id", s!.id);
    const { data: after } = await adminClient().from("suppliers")
      .select("name, former_names").eq("id", s!.id).single();
    expect(after!.name).toBe(`Casing Probe ${stamp}`);
    expect(after!.former_names as string[]).toHaveLength(0);
  });
});
