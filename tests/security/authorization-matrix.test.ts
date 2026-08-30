import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { AUTHORIZATION_MATRIX, type MatrixCase, type MatrixRole } from "./authorization-matrix";

/**
 * Drives every row of the authorization matrix against the real database.
 *
 * A failure here means one of four things, in this order of likelihood:
 *   1. the matrix row is wrong,
 *   2. the fixture is wrong,
 *   3. documented behaviour is wrong,
 *   4. authorization genuinely regressed.
 * Resolve it in that order. Never relax a policy to turn this green.
 */
describe("authorization matrix", () => {
  const users = new Map<MatrixRole, TestUser>();
  let ownSite: string, otherSite: string, hqSite: string;
  let ownSupplier: string, material: string;
  const seeded: Record<string, { own: string; other: string }> = {};

  const tag = String(Date.now()).slice(-9);

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    hqSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    ownSite = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== ownSite)!.id as string;

    // The "general" roles are defined by being posted to New-Site.
    users.set("owner", await makeUser({ username: `mx-own-${tag}`, role: "owner", siteId: null }));
    users.set("general_manager", await makeUser({ username: `mx-gm-${tag}`, role: "manager", siteId: hqSite }));
    users.set("site_manager", await makeUser({ username: `mx-sm-${tag}`, role: "manager", siteId: ownSite }));
    users.set("general_accountant", await makeUser({ username: `mx-ga-${tag}`, role: "accounting", siteId: hqSite }));
    users.set("site_accounting", await makeUser({ username: `mx-sa-${tag}`, role: "accounting", siteId: ownSite }));
    users.set("inventory", await makeUser({ username: `mx-inv-${tag}`, role: "inventory", siteId: ownSite }));
    users.set("receiving", await makeUser({ username: `mx-rcv-${tag}`, role: "receiving", siteId: ownSite }));
    users.set("qc", await makeUser({ username: `mx-qc-${tag}`, role: "qc", siteId: ownSite }));
    users.set("processing", await makeUser({ username: `mx-prc-${tag}`, role: "processing", siteId: ownSite }));
    users.set("stock_keeper", await makeUser({ username: `mx-sk-${tag}`, role: "stock_keeper", siteId: ownSite }));
    users.set("gate", await makeUser({ username: `mx-gate-${tag}`, role: "gate", siteId: ownSite }));

    const { data: sup } = await adminClient().from("suppliers")
      .insert({ name: `MX Supplier ${tag}` }).select("id").single();
    ownSupplier = sup!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `MX-Ore ${tag}` }).select("id").single();
    material = mt!.id as string;

    // One row of every resource at each site, so "own" and "other" are real.
    const mkVisit = async (site: string) => {
      const { data } = await adminClient().from("visits").insert({
        site_id: site, supplier_id: ownSupplier, declared_material_type_id: material,
        entry_path: "processed", state: "in_qc", created_by: users.get("receiving")!.userId,
      }).select("id").single();
      return data!.id as string;
    };
    seeded.visits = { own: await mkVisit(ownSite), other: await mkVisit(otherSite) };

    const mkSettlement = async (site: string, visitId: string) => {
      const { data } = await adminClient().from("batch_settlements").insert({
        visit_id: visitId, site_id: site, materials_total: 1000, light_bill_total: 0,
        other_deductions_total: 0, advance_deducted: 0, net_balance: 1000,
        submitted_by: users.get("receiving")!.userId, status: "approved",
      }).select("id").single();
      return data!.id as string;
    };
    seeded.batch_settlements = {
      own: await mkSettlement(ownSite, seeded.visits.own),
      other: await mkSettlement(otherSite, seeded.visits.other),
    };

    const mkAdvance = async (site: string) => {
      const { data } = await adminClient().from("advances").insert({
        supplier_id: ownSupplier, site_id: site, purpose: `MX ${tag}`, amount_naira: 500,
      }).select("id").single();
      return data!.id as string;
    };
    seeded.advances = { own: await mkAdvance(ownSite), other: await mkAdvance(otherSite) };

    const mkLot = async (site: string) => {
      const { data } = await adminClient().from("stock_lots").insert({
        site_id: site, material_type_id: material, supplier_id: ownSupplier,
        weight_kg: 25, cost_price_per_kg: 100, status: "available",
      }).select("id").single();
      return data!.id as string;
    };
    seeded.stock_lots = { own: await mkLot(ownSite), other: await mkLot(otherSite) };

    const mkExpense = async (site: string) => {
      const { data } = await adminClient().from("consumables").insert({
        site_id: site, name: `MX expense ${tag} ${site.slice(0, 4)}`, category: "others", amount_naira: 100,
      }).select("id").single();
      return data!.id as string;
    };
    seeded.consumables = { own: await mkExpense(ownSite), other: await mkExpense(otherSite) };

    const { data: ev } = await adminClient().from("transaction_events")
      .select("id").eq("visit_id", seeded.visits.other).limit(1).maybeSingle();
    seeded.transaction_events = { own: ev?.id as string ?? "", other: ev?.id as string ?? "" };

    seeded.suppliers = { own: ownSupplier, other: ownSupplier };
    seeded.profiles_other_users = {
      own: users.get("owner")!.userId,
      other: users.get("owner")!.userId,
    };
  });

  // A read is ALLOWed when the row comes back, DENIed when RLS filters it out.
  async function attemptRead(c: MatrixCase): Promise<"ALLOW" | "DENY"> {
    const u = users.get(c.role)!;
    const table = c.resource === "profiles_other_users" ? "profiles" : c.resource;
    const id = c.site === "other" ? seeded[c.resource].other : seeded[c.resource].own;
    if (!id) throw new Error(`no fixture for ${c.resource}`);
    const { data, error } = await u.client.from(table).select("id").eq("id", id);
    if (error) return "DENY";
    return (data ?? []).length > 0 ? "ALLOW" : "DENY";
  }

  // A write is ALLOWed only when the row is actually changed — PostgREST reports
  // success with zero rows when RLS filters the write, which is not permission.
  async function attemptWrite(c: MatrixCase): Promise<"ALLOW" | "DENY"> {
    const u = users.get(c.role)!;
    if (c.resource === "consumables") {
      const site = c.site === "other" ? otherSite : ownSite;
      const { data, error } = await u.client.from("consumables").insert({
        site_id: site, name: `MX write ${tag} ${Math.random()}`, category: "others", amount_naira: 10,
      }).select("id");
      return !error && (data ?? []).length > 0 ? "ALLOW" : "DENY";
    }
    throw new Error(`no write probe defined for ${c.resource}`);
  }

  for (const c of AUTHORIZATION_MATRIX) {
    const label = `${c.role} | ${c.resource} (${c.site}) | ${c.action} → ${c.expect}`;
    it(label, async () => {
      const actual = c.action === "read" ? await attemptRead(c) : await attemptWrite(c);
      expect(actual, `${label}\n  rule: ${c.because}`).toBe(c.expect);
    });
  }
});
