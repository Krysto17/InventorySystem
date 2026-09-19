import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs } from "../setup/approvals";

/**
 * 0163 — Phase 3F-T8: F-11 duplicate / retry integrity.
 *
 * One intended action must produce at most one business effect. On 0162 it did
 * not: submitting the same action twice paid a ₦30,000 payout twice, recovered
 * the same ₦50,000 of debt twice, took 200 kg out of the bucket for one 100 kg
 * sale, and turned one expense, one advance, one light bill, one material line,
 * one draft run, one gate log and one gate pass into two of each.
 *
 * The business fields cannot tell a retry from a second genuine action — two
 * ₦50,000 repayments in a day are legitimate, so are two identical expenses —
 * so what is unique here is the COMMAND, carried on the row as `request_key`
 * behind a partial unique index. Historical rows keep a NULL key and are
 * untouched; a caller that sends no key is stamped with one, so omitting it
 * forfeits replay protection without opening a way round the index.
 */
describe("duplicate / retry integrity (0163)", () => {
  const stamp = Date.now().toString(36);
  const DUP = "23505";
  const DEADLOCK = "40P01";
  let dong: string, sup: string, mat: string;
  let owner: TestUser, acct: TestUser, mgr: TestUser, inv: TestUser, gate: TestUser;
  const key = () => crypto.randomUUID();

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    dong = sites!.find((s) => s.name === "Dong")!.id as string;
    sup = (await admin.from("suppliers").insert({ name: `T8 supplier ${stamp}` }).select("id").single()).data!.id as string;
    mat = (await admin.from("material_types").insert({ name: `T8 ${stamp}` }).select("id").single()).data!.id as string;
    owner = await makeUser({ username: `t8-owner-${stamp}`, role: "owner", siteId: null });
    acct = await makeUser({ username: `t8-acct-${stamp}`, role: "accounting", siteId: dong });
    mgr = await makeUser({ username: `t8-mgr-${stamp}`, role: "manager", siteId: dong });
    inv = await makeUser({ username: `t8-inv-${stamp}`, role: "inventory", siteId: dong });
    gate = await makeUser({ username: `t8-gate-${stamp}`, role: "gate", siteId: dong });
    // Debt to recover against, so the deduction cases test duplication rather
    // than tripping 0153's over-deduction guard.
    await admin.from("advances").insert({
      supplier_id: sup, site_id: dong, purpose: `T8 float ${stamp}`,
      amount_naira: 5_000_000, recorded_by: mgr.id, approval_status: "paid",
    });
  });

  // ── payments (highest impact) ─────────────────────────────────────────────

  async function approvedSettlement(total = 100000) {
    const admin = adminClient();
    const { data: v } = await admin.from("visits").insert({
      site_id: dong, supplier_id: sup, declared_material_type_id: mat,
      entry_path: "processed", state: "awaiting_price_approval", created_by: owner.id,
    }).select("id").single();
    const visitId = (v as { id: string }).id;
    await admin.from("visit_materials").insert({
      visit_id: visitId, material_type_id: mat, weight_kg: total / 100, unit_price: 100, requires_analysis: false,
    });
    expect((await approvePricingAs(owner.client, visitId)).error).toBeNull();
    const { data: s } = await admin.from("batch_settlements").select("id").eq("visit_id", visitId).single();
    return { visitId, settlementId: (s as { id: string }).id };
  }
  const pay = (u: TestUser, settlementId: string, amount: number, k: string) =>
    u.client.rpc("record_settlement_payment", {
      p_settlement_id: settlementId, p_amount: amount, p_method: "transfer", p_request_key: k,
    });
  const paymentsOf = async (settlementId: string) =>
    (await adminClient().from("settlement_payments").select("id, amount").eq("settlement_id", settlementId)).data ?? [];

  it("1. the same payment submitted twice pays once, and the replay returns the first payment", async () => {
    const { settlementId } = await approvedSettlement();
    const k = key();
    const first = await pay(acct, settlementId, 30000, k);
    expect(first.error).toBeNull();
    const replay = await pay(acct, settlementId, 30000, k);
    expect(replay.error, "a replay is a success, not an alarm").toBeNull();
    expect(replay.data, "and it is the SAME payment").toBe(first.data);
    const rows = await paymentsOf(settlementId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(30000);
  });

  it("2. a genuine second installment still goes through", async () => {
    const { settlementId } = await approvedSettlement();
    expect((await pay(acct, settlementId, 30000, key())).error).toBeNull();
    expect((await pay(acct, settlementId, 20000, key())).error).toBeNull();
    const rows = await paymentsOf(settlementId);
    expect(rows, "installments are legitimate and must not be collapsed").toHaveLength(2);
    expect(rows.reduce((t, r) => t + Number(r.amount), 0)).toBe(50000);
  });

  it("3. two identical payment commands racing produce one payment, no deadlock", async () => {
    for (let t = 1; t <= 3; t++) {
      const { settlementId } = await approvedSettlement();
      const k = key();
      const [a, b] = await Promise.all([pay(acct, settlementId, 40000, k), pay(acct, settlementId, 40000, k)]);
      for (const [n, r] of [["A", a], ["B", b]] as const) {
        expect(r.error?.code, `trial ${t}: ${n}`).not.toBe(DEADLOCK);
        expect(r.error, `trial ${t}: ${n} must settle as success`).toBeNull();
      }
      expect(a.data, `trial ${t}: both see the same payment`).toBe(b.data);
      expect(await paymentsOf(settlementId), `trial ${t}`).toHaveLength(1);
    }
  });

  it("4. a payment completing the settlement stocks the batch exactly once", async () => {
    const { visitId, settlementId } = await approvedSettlement(50000);
    const k = key();
    expect((await pay(acct, settlementId, 50000, k)).error).toBeNull();
    expect((await pay(acct, settlementId, 50000, k)).error, "replay").toBeNull();
    const admin = adminClient();
    expect((await admin.from("batch_settlements").select("status").eq("id", settlementId).single()).data!.status).toBe("paid");
    const lots = (await admin.from("stock_lots").select("id, ref_visit_material_id")).data ?? [];
    const lines = (await admin.from("visit_materials").select("id").eq("visit_id", visitId)).data ?? [];
    const mine = lots.filter((l) => lines.some((x) => x.id === l.ref_visit_material_id));
    expect(mine, "one lot, not two").toHaveLength(1);
    const intake = (await admin.from("stock_movements").select("id")
      .eq("ref_visit_id", visitId).eq("reason", "purchase_intake")).data ?? [];
    expect(intake, "one intake movement, not two").toHaveLength(1);
  });

  it("5. a payment with no command id is refused", async () => {
    const { settlementId } = await approvedSettlement();
    const res = await acct.client.rpc("record_settlement_payment", {
      p_settlement_id: settlementId, p_amount: 1000, p_method: "transfer",
    } as never);
    expect(res.error, "there is no versionless payment path").not.toBeNull();
    expect(res.error!.code).toBe("ID001");
    expect(await paymentsOf(settlementId)).toHaveLength(0);
  });

  // ── the insert-based commands ─────────────────────────────────────────────

  type Case = {
    name: string;
    run: (k: string | null) => PromiseLike<{ error: { code?: string } | null }>;
    count: () => Promise<number>;
  };

  const cases: Case[] = [
    {
      name: "debt recovery",
      run: (k) => acct.client.from("advance_deductions").insert({
        supplier_id: sup, site_id: dong, ref_visit_id: null, amount: 50000,
        kind: "advance", recorded_by: acct.id, ...(k ? { request_key: k } : {}),
      }).select("id").then((r) => ({ error: r.error })),
      count: async () => ((await adminClient().from("advance_deductions").select("id").eq("supplier_id", sup)).data ?? []).length,
    },
    {
      name: "expense",
      run: (k) => inv.client.from("consumables").insert({
        site_id: dong, name: `T8 dup ${stamp}`, category: "fuel_lubricants",
        amount_naira: 12000, recorded_by: inv.id, ...(k ? { request_key: k } : {}),
      }).select("id").then((r) => ({ error: r.error })),
      count: async () => ((await adminClient().from("consumables").select("id").eq("name", `T8 dup ${stamp}`)).data ?? []).length,
    },
    {
      name: "advance",
      run: (k) => mgr.client.from("advances").insert({
        supplier_id: sup, site_id: dong, purpose: `T8 dup ${stamp}`, amount_naira: 75000,
        recorded_by: mgr.id, ...(k ? { request_key: k } : {}),
      }).select("id").then((r) => ({ error: r.error })),
      count: async () => ((await adminClient().from("advances").select("id").eq("purpose", `T8 dup ${stamp}`)).data ?? []).length,
    },
    {
      name: "cost-price run",
      run: (k) => inv.client.from("cost_price_runs").insert({
        site_id: dong, label: `T8 dup ${stamp}`, approval_status: "pending",
        created_by: inv.id, ...(k ? { request_key: k } : {}),
      }).select("id").then((r) => ({ error: r.error })),
      count: async () => ((await adminClient().from("cost_price_runs").select("id").eq("label", `T8 dup ${stamp}`)).data ?? []).length,
    },
    {
      name: "gate log",
      run: (k) => gate.client.from("gate_logs").insert({
        site_id: dong, direction: "out", driver_name: `T8 ${stamp}`, bags: 12,
        reason: `T8 dup ${stamp}`, recorded_by: gate.id, ...(k ? { request_key: k } : {}),
      }).select("id").then((r) => ({ error: r.error })),
      count: async () => ((await adminClient().from("gate_logs").select("id").eq("reason", `T8 dup ${stamp}`)).data ?? []).length,
    },
    {
      name: "gate pass",
      run: (k) => owner.client.from("gate_passes").insert({
        site_id: dong, reason: `T8 dup ${stamp}`, status: "issued",
        issued_by: owner.id, ...(k ? { request_key: k } : {}),
      }).select("id").then((r) => ({ error: r.error })),
      count: async () => ((await adminClient().from("gate_passes").select("id").eq("reason", `T8 dup ${stamp}`)).data ?? []).length,
    },
  ];

  it("6. resubmitting the same command creates one row; a new command creates a second", async () => {
    for (const c of cases) {
      const before = await c.count();
      const k = key();
      expect((await c.run(k)).error, `${c.name}: first submit`).toBeNull();
      const replay = await c.run(k);
      expect(replay.error?.code, `${c.name}: the replay is refused`).toBe(DUP);
      expect(await c.count(), `${c.name}: one row from one command`).toBe(before + 1);

      // identical business values, a different intent
      expect((await c.run(key())).error, `${c.name}: a genuine second action`).toBeNull();
      expect(await c.count(), `${c.name}: two rows from two commands`).toBe(before + 2);
    }
  });

  it("7. the same command racing itself lands once", async () => {
    for (const c of cases) {
      const before = await c.count();
      const k = key();
      const [a, b] = await Promise.all([c.run(k), c.run(k)]);
      for (const [n, r] of [["A", a], ["B", b]] as const) {
        expect(r.error?.code, `${c.name}: ${n} must not deadlock`).not.toBe(DEADLOCK);
      }
      expect([a.error, b.error].filter((e) => e === null), `${c.name}: exactly one lands`).toHaveLength(1);
      expect([a.error, b.error].filter((e) => e?.code === DUP), `${c.name}: the other is a replay`).toHaveLength(1);
      expect(await c.count(), `${c.name}`).toBe(before + 1);
    }
  });

  it("8. different commands with identical values racing both land", async () => {
    for (const c of cases) {
      const before = await c.count();
      const [a, b] = await Promise.all([c.run(key()), c.run(key())]);
      expect(a.error, `${c.name}: A`).toBeNull();
      expect(b.error, `${c.name}: B`).toBeNull();
      expect(await c.count(), `${c.name}: two legitimate actions`).toBe(before + 2);
    }
  });

  // ── stock ─────────────────────────────────────────────────────────────────

  const bucket = async () => {
    const rows = (await adminClient().from("stock_movements").select("weight, direction").eq("material_type_id", mat)).data ?? [];
    return rows.reduce((t, r) => t + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)), 0);
  };

  it("9. a resubmitted sale does not take stock twice (ample stock, so oversell cannot mask it)", async () => {
    await adminClient().from("stock_movements").insert({
      site_id: dong, material_type_id: mat, weight: 1000, direction: "in",
      recorded_by: owner.id, reason: "purchase_intake",
    });
    const before = await bucket();
    const k = key();
    const sale = (kk: string) => owner.client.from("stock_movements").insert({
      site_id: dong, material_type_id: mat, weight: 100, direction: "out",
      recorded_by: owner.id, reason: "bulk_sale", request_key: kk,
    }).select("id");
    expect((await sale(k)).error).toBeNull();
    expect((await sale(k)).error?.code, "the replay takes nothing").toBe(DUP);
    expect(await bucket(), "100 kg left, not 200").toBe(before - 100);

    expect((await sale(key())).error, "a genuine second sale is allowed").toBeNull();
    expect(await bucket()).toBe(before - 200);
  });

  // ── no bypass ─────────────────────────────────────────────────────────────

  it("10. a caller that omits the key is stamped with one and cannot suppress another row", async () => {
    const name = `T8 nokey ${stamp}`;
    const insert = () => inv.client.from("consumables").insert({
      site_id: dong, name, category: "others", amount_naira: 500, recorded_by: inv.id,
    }).select("id, request_key");
    const a = await insert();
    expect(a.error).toBeNull();
    expect((a.data as Array<{ request_key: string | null }>)[0].request_key,
      "the server stamps a key so the index still covers the row").not.toBeNull();
    const b = await insert();
    expect(b.error, "omitting the key forfeits replay protection, it does not bypass anything").toBeNull();
    expect((b.data as Array<{ request_key: string | null }>)[0].request_key)
      .not.toBe((a.data as Array<{ request_key: string | null }>)[0].request_key);
  });

  it("11. the service role is not exempt from the command index", async () => {
    const k = key();
    const row = () => adminClient().from("advance_deductions").insert({
      supplier_id: sup, site_id: dong, ref_visit_id: null, amount: 1000,
      kind: "advance", recorded_by: acct.id, request_key: k,
    }).select("id");
    expect((await row()).error).toBeNull();
    expect((await row()).error?.code, "service role replays are refused too").toBe(DUP);
  });

  // ── already protected before this tranche ─────────────────────────────────

  it("12. protections that already existed are not duplicated here", async () => {
    const admin = adminClient();
    // one live lot-linked pass (0155)
    await admin.from("stock_movements").insert({
      site_id: dong, material_type_id: mat, weight: 50, direction: "in",
      recorded_by: owner.id, reason: "purchase_intake",
    });
    const { data: lot } = await admin.from("stock_lots").insert({
      site_id: dong, material_type_id: mat, weight_kg: 50, status: "available", cost_price_per_kg: 10,
    }).select("id").single();
    const lotId = (lot as { id: string }).id;
    const pass = (k: string) => owner.client.from("gate_passes").insert({
      site_id: dong, reason: `T8 lot ${stamp}`, status: "issued", stock_lot_id: lotId,
      issued_by: owner.id, request_key: k,
    }).select("id");
    expect((await pass(key())).error).toBeNull();
    // a DIFFERENT command, but 0155 still allows only one live pass per lot
    expect((await pass(key())).error?.code, "0155 still answers").toBe(DUP);
  });

  // ── the app carries a command id ──────────────────────────────────────────

  it("13. every idempotent action reads the command id, and the form mints one", () => {
    const form = readFileSync("src/components/ui/ActionForm.tsx", "utf8");
    expect(form, "the form mints a command id").toContain("REQUEST_KEY_FIELD");
    expect(form, "minted per submit, not per render").toContain("crypto.randomUUID()");
    expect(form, "and cleared only once the action succeeded").toContain("commandId.current = null");

    for (const [file, fn] of [
      ["app/visits/[id]/finance-actions.ts", "recordSettlementPayment"],
      ["app/visits/[id]/finance-actions.ts", "recordDeduction"],
      ["app/visits/[id]/finance-actions.ts", "addUtilityCharge"],
      ["app/(inventory)/inventory/consumables/actions.ts", "createConsumable"],
      ["app/(manager)/manager/advances/actions.ts", "recordAdvance"],
      ["app/(manager)/manager/cost-price/actions.ts", "saveCostRun"],
    ] as const) {
      const src = readFileSync(`src/${file}`, "utf8");
      const at = src.indexOf(`export async function ${fn}(`);
      if (at === -1) continue;
      const next = src.indexOf("\nexport async function ", at + 1);
      const body = src.slice(at, next === -1 ? undefined : next);
      // Either spelling carries the command id: the final app reads it
      // directly, the rollout bridge reads it inside requestKeyPayload.
      expect(body, `${fn} must carry the command id`)
        .toMatch(/requestKeyFrom\(formData\)|requestKeyPayload\(formData\)/);
    }
  });
});
