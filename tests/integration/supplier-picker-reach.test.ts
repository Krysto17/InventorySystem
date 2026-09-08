import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * Every supplier must stay reachable in the picker as the roster grows.
 *
 * The advances screen fetched `suppliers ... order(name) limit(300)` and handed
 * that array to SupplierPicker, which filtered it in the browser. Once the
 * business passed 300 suppliers the tail of the alphabet stopped being
 * selectable: at 319 suppliers, 19 were unreachable — including WOKRIT EMMANUEL,
 * who already had 21 advances. The gate-pass picker capped at 200 and hid 119.
 *
 * Nothing was wrong with the data: every advance resolved its supplier, and
 * suppliers are readable by any authenticated user. It was purely an ordered cap
 * with no pagination and no sign it had cut anything — the same shape as the
 * cost-price lot list.
 *
 * The picker now searches the database as well as its seed list, so the cap only
 * decides the first few suggestions. This proves the mechanism at the level it
 * lives — the query — because the repository has no DOM/component harness to
 * render the picker in.
 */

const SOURCE = new URL("../../src/components/suppliers/SupplierPicker.tsx", import.meta.url);
const source = () => readFileSync(SOURCE, "utf8");

describe("supplier picker reach", () => {
  let manager: TestUser;
  const stamp = Date.now();
  // Sorts after every real supplier, so it is always in the cut-off tail.
  const tailName = `zzz-picker-${stamp}`;
  let tailId: string;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    const siteId = sites!.find((s) => s.name === "Dong")!.id as string;
    manager = await makeUser({ username: `picker-${stamp}`, role: "manager", siteId });
    const { data, error } = await admin.from("suppliers")
      .insert({ name: tailName }).select("id").single();
    expect(error, `supplier fixture: ${error?.message}`).toBeNull();
    tailId = data!.id as string;
  });

  afterAll(async () => {
    await adminClient().from("suppliers").delete().eq("id", tailId);
  });

  it("an ordered cap hides the tail of the roster — the defect", async () => {
    // Cap the roster exactly at the number of suppliers sorting before ours, so
    // ours is the first one cut. That is what limit(300) did at 319 suppliers.
    const { count } = await manager.client.from("suppliers")
      .select("id", { count: "exact", head: true }).lt("name", tailName);
    const { data } = await manager.client.from("suppliers")
      .select("id").order("name").limit(count ?? 0);
    expect(
      (data ?? []).some((s) => s.id === tailId),
      "the capped roster must NOT contain the supplier past the cap",
    ).toBe(false);
  });

  it("the picker's search finds a supplier the capped roster misses", async () => {
    // The query SupplierPicker now runs. It is not bounded by the roster cap.
    const term = `picker-${stamp}`;
    const { data, error } = await manager.client.from("suppliers")
      .select("id, name, supplier_code")
      .or(`name.ilike.%${term}%,supplier_code.ilike.%${term}%`)
      .order("name")
      .limit(8);
    expect(error, `search: ${error?.message}`).toBeNull();
    expect(
      (data ?? []).some((s) => s.id === tailId),
      "search must reach a supplier beyond the cap",
    ).toBe(true);
  });

  it("the search also matches on supplier code, not just name", async () => {
    const { data: sup } = await adminClient()
      .from("suppliers").select("supplier_code").eq("id", tailId).single();
    const code = sup!.supplier_code as string | null;
    expect(code, "suppliers are assigned a business code on insert").not.toBeNull();
    const { data } = await manager.client.from("suppliers")
      .select("id")
      .or(`name.ilike.%${code}%,supplier_code.ilike.%${code}%`)
      .limit(8);
    expect((data ?? []).some((s) => s.id === tailId), "code search must find it").toBe(true);
  });

  // ── Names a typed search could never match ───────────────────────────────
  describe("awkward names stay findable", () => {
    // Real production names: two carry a double space, three a typographic
    // apostrophe. Typing them as they look produced no match at all.
    const cases = [
      { label: "double space", stored: `Lucky  Elisha ${stamp}`, typed: `Lucky Elisha ${stamp}` },
      { label: "typographic apostrophe", stored: `Mus\u2019ab Umar ${stamp}`, typed: `Mus'ab Umar ${stamp}` },
    ];
    const ids: string[] = [];

    beforeAll(async () => {
      for (const c of cases) {
        const { data, error } = await adminClient().from("suppliers")
          .insert({ name: c.stored }).select("id").single();
        expect(error, `${c.label} fixture: ${error?.message}`).toBeNull();
        ids.push(data!.id as string);
      }
    });

    afterAll(async () => {
      if (ids.length) await adminClient().from("suppliers").delete().in("id", ids);
    });

    for (const [i, c] of cases.entries()) {
      it(`a whole-string search misses "${c.label}" — the defect`, async () => {
        const { data } = await manager.client.from("suppliers")
          .select("id").ilike("name", `%${c.typed}%`).limit(8);
        expect(
          (data ?? []).some((s) => s.id === ids[i]),
          "typing the name as it looks must NOT match, which is the bug",
        ).toBe(false);
      });

      it(`the tokenised search finds "${c.label}"`, async () => {
        // What the picker now does: split on non-letters, AND the words.
        const tokens = c.typed.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        let query = manager.client.from("suppliers").select("id");
        for (const tok of tokens) {
          query = query.or(`name.ilike.%${tok}%,supplier_code.ilike.%${tok}%`);
        }
        const { data, error } = await query.limit(8);
        expect(error, `search: ${error?.message}`).toBeNull();
        expect(
          (data ?? []).some((s) => s.id === ids[i]),
          "every word matches, so spacing and apostrophe style stop mattering",
        ).toBe(true);
      });
    }
  });

  it("SupplierPicker queries the database, not only the array it was given", () => {
    const s = source();
    expect(s, "must query suppliers itself").toMatch(/from\("suppliers"\)/);
    expect(s, "must search name or code server-side").toMatch(/name\.ilike|supplier_code\.ilike/);
    expect(s, "must match word by word, not on the whole string")
      .toMatch(/for \(const tok of tokens\)/);
    expect(s, "must debounce so it does not fire per keystroke").toMatch(/setTimeout\(/);
    // The seed list must still be used, so a small roster answers instantly.
    expect(s, "must still offer the list it was handed").toMatch(/suppliers\.slice\(0, 8\)/);
  });

  it("neither picker page treats its seed cap as the source of truth", () => {
    // A future reader must not "optimise" the search away and reintroduce the cap.
    for (const p of ["app/(manager)/manager/advances/page.tsx",
                     "app/(manager)/manager/gate-passes/page.tsx"]) {
      const page = readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
      expect(page, `${p} must record why the cap is safe`).toMatch(/Seed suggestions only/);
    }
  });
});
