import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Catch duplicate suppliers before they're created, and merge safely the ones
// that slip through. Modelled on the real "Madam Maria" / "Maria Dung" case.
describe("supplier duplicate detection + merge", () => {
  let siteId: string, newSite: string, monazite: string;
  let owner: TestUser, gm: TestUser, siteMgr: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    owner = await makeUser({ username: "dm-owner", role: "owner", siteId: null });
    gm = await makeUser({ username: "dm-gm", role: "manager", siteId: newSite });
    siteMgr = await makeUser({ username: "dm-sm", role: "manager", siteId });
    recv = await makeUser({ username: "dm-recv", role: "receiving", siteId });
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  const mkSupplier = async (name: string, acct?: string) => {
    const { data } = await adminClient().from("suppliers").insert({
      name,
      ...(acct ? { account_name: name, account_number: acct, bank_name: "Access" } : {}),
    }).select("id").single();
    return data!.id as string;
  };

  it("flags an existing supplier whose name contains the new one", async () => {
    const tag = `Maria Dung ${Date.now()}`;
    await mkSupplier(tag);
    const { data } = await gm.client.rpc("find_similar_suppliers", { p_name: tag });
    expect((data ?? []).some((r: { name: string }) => r.name === tag)).toBe(true);
  });

  it("flags a supplier sharing the SAME account number (strongest signal)", async () => {
    const acct = String(Date.now()).slice(-10);
    const id = await mkSupplier(`Totally Different Name ${Date.now()}`, acct);
    const { data } = await gm.client.rpc("find_similar_suppliers", {
      p_name: "Nothing Alike At All", p_account_number: acct,
    });
    const hit = (data ?? []).find((r: { id: string }) => r.id === id);
    expect(hit).toBeTruthy();
    expect(hit.same_account).toBe(true);
  });

  it("excludes the supplier being edited", async () => {
    const id = await mkSupplier(`Self Exclude ${Date.now()}`);
    const { data } = await gm.client.rpc("find_similar_suppliers", { p_name: "Self Exclude", p_exclude: id });
    expect((data ?? []).some((r: { id: string }) => r.id === id)).toBe(false);
  });

  it("merges a duplicate: records move, name kept as history, duplicate gone", async () => {
    const stamp = Date.now();
    const keep = await mkSupplier(`Maria Dung ${stamp}`, String(stamp).slice(-10));
    const dupe = await mkSupplier(`Madam Maria ${stamp}`);

    // Give the duplicate real records.
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: dupe, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("stock_lots").insert({
      site_id: siteId, material_type_id: monazite, supplier_id: dupe,
      weight_kg: 10, cost_price_per_kg: 5, recorded_by: recv.userId,
    });

    const { error } = await gm.client.rpc("merge_suppliers", { p_keep: keep, p_duplicate: dupe });
    expect(error).toBeNull();

    // Records moved.
    expect((await adminClient().from("visits").select("supplier_id").eq("id", v!.id).single()).data!.supplier_id).toBe(keep);
    expect((await adminClient().from("stock_lots").select("id").eq("supplier_id", dupe)).data!.length).toBe(0);
    // Duplicate removed, its name kept as history.
    expect((await adminClient().from("suppliers").select("id").eq("id", dupe).maybeSingle()).data).toBeNull();
    const kept = (await adminClient().from("suppliers").select("former_names").eq("id", keep).single()).data!;
    expect((kept.former_names as string[]).some((n) => n.startsWith("Madam Maria"))).toBe(true);
  });

  it("a site manager cannot merge suppliers", async () => {
    const a = await mkSupplier(`A ${Date.now()}`);
    const b = await mkSupplier(`B ${Date.now()}`);
    const { error } = await siteMgr.client.rpc("merge_suppliers", { p_keep: a, p_duplicate: b });
    expect(error).not.toBeNull();
    expect((await adminClient().from("suppliers").select("id").eq("id", b).maybeSingle()).data).not.toBeNull();
  });

  it("refuses to merge a supplier into itself", async () => {
    const a = await mkSupplier(`Solo ${Date.now()}`);
    expect((await owner.client.rpc("merge_suppliers", { p_keep: a, p_duplicate: a })).error).not.toBeNull();
  });
});
