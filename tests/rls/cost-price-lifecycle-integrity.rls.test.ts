import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approveCostRunAs } from "../setup/approvals";
import { costPriceRefusal } from "@/lib/cost-price/refusals";

/**
 * 0160 — cost-price run lifecycle integrity (Phase 3F-T5: F-06, F-15).
 *
 * APPROVED is the historical record of a sale: its row, lot membership, extras
 * and the lot figures it was computed from are immutable for every caller
 * (CP001), owner, general manager and service role included. Approval happens
 * once, from pending (CP004), needs a stock lot (CP005), rechecks every lot under
 * lock (CP002 / GP007) and recomputes from the locked rows.
 *
 * A PENDING run is a draft that reserves its lots (CP003). A lot that leaves
 * stock anyway stays in the draft, visibly, until someone removes it.
 */
describe("cost-price run lifecycle integrity (0160)", () => {
  const stamp = Date.now().toString(36);
  const REPEAT = 6;
  const DEADLOCK = "40P01";
  let site: string, mat: string, sup: string;
  let owner: TestUser, gm: TestUser, inv: TestUser, gate: TestUser;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    site = sites!.find((s) => s.name === "New-Site")!.id as string;
    // A material of its own keeps this file's stock buckets apart from every other.
    mat = (await admin.from("material_types").insert({ name: `CPL ${stamp}` }).select("id").single()).data!.id as string;
    sup = (await admin.from("suppliers").insert({ name: `CPL supplier ${stamp}` }).select("id").single()).data!.id as string;
    owner = await makeUser({ username: `cpl-owner-${stamp}`, role: "owner", siteId: null });
    gm = await makeUser({ username: `cpl-gm-${stamp}`, role: "manager", siteId: site });
    inv = await makeUser({ username: `cpl-inv-${stamp}`, role: "inventory", siteId: site });
    gate = await makeUser({ username: `cpl-gate-${stamp}`, role: "gate", siteId: site });
  });

  // ── fixtures ───────────────────────────────────────────────────────────────
  async function lot(kg = 100, cost = 50) {
    const admin = adminClient();
    expect((await admin.from("stock_movements").insert({
      site_id: site, material_type_id: mat, weight: kg, direction: "in", reason: "purchase_intake", recorded_by: owner.userId,
    })).error).toBeNull();
    const { data, error } = await admin.from("stock_lots").insert({
      site_id: site, material_type_id: mat, supplier_id: sup, weight_kg: kg, cost_price_per_kg: cost, recorded_by: owner.userId,
    }).select("id").single();
    expect(error, `lot fixture: ${error?.message}`).toBeNull();
    return data!.id as string;
  }
  // A draft formed the way the screen forms it: the author inserts the run, then its lots and extras.
  async function draft(by: TestUser, lots: string[], extras: { kg: number; cost: number }[] = [], status: "pending" | null = "pending") {
    const { data: run, error } = await by.client.from("cost_price_runs").insert({
      site_id: site, label: `CPL ${stamp} ${Math.random()}`, material_type_id: mat, approval_status: status, created_by: by.userId,
    }).select("id").single();
    expect(error, `run fixture: ${error?.message}`).toBeNull();
    for (const id of lots) {
      const r = await by.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: id });
      expect(r.error, `lot link: ${r.error?.message}`).toBeNull();
    }
    for (const e of extras) {
      const r = await by.client.from("cost_price_run_extras").insert({ run_id: run!.id, material_name: "Bought tin", weight_kg: e.kg, cost_price_per_kg: e.cost });
      expect(r.error, `extra: ${r.error?.message}`).toBeNull();
    }
    return run!.id as string;
  }
  // Exactly what approveCostBatch sends. 0162: approval names the run version
  // the owner reviewed; a direct table UPDATE can no longer approve at all.
  const approve = (runId: string, who: TestUser = owner) => approveCostRunAs(who.client, runId);
  const reject = (runId: string) =>
    owner.client.from("cost_price_runs").update({ approval_status: "rejected", approved_by: owner.userId })
      .eq("id", runId).eq("approval_status", "pending").select("id");
  async function approvedRun() {
    const runId = await draft(inv, [await lot(100, 50), await lot(200, 80)], [{ kg: 100, cost: 20 }]);
    const res = await approve(runId);
    expect(res.error, `approve: ${res.error?.message}`).toBeNull();
    // 0162: approval is an RPC now, so the proof is the run's own state.
    expect((await adminClient().from("cost_price_runs").select("approval_status")
      .eq("id", runId).single()).data!.approval_status).toBe("approved");
    return runId;
  }
  // Everything an approved run's history is made of, as one comparable value.
  async function snapshot(runId: string) {
    const admin = adminClient();
    const run = (await admin.from("cost_price_runs").select("*").eq("id", runId).single()).data;
    const links = (await admin.from("cost_price_run_lots").select("stock_lot_id").eq("run_id", runId).order("stock_lot_id")).data ?? [];
    const lots = (await admin.from("stock_lots").select("id, status, weight_kg, cost_price_per_kg, site_id, material_type_id")
      .in("id", links.map((l) => l.stock_lot_id as string)).order("id")).data;
    const extras = (await admin.from("cost_price_run_extras").select("*").eq("run_id", runId).order("id")).data;
    return JSON.stringify({ run, links, lots, extras });
  }
  const runRow = async (id: string) =>
    (await adminClient().from("cost_price_runs").select("*").eq("id", id).single()).data!;
  const lotStatus = async (id: string) =>
    (await adminClient().from("stock_lots").select("status").eq("id", id).single()).data!.status as string;
  const mixedOuts = async () =>
    (await adminClient().from("stock_movements").select("id", { count: "exact", head: true })
      .eq("material_type_id", mat).eq("reason", "mixed_batch")).count ?? 0;
  const issuePass = async (lotId: string) => {
    const { data, error } = await adminClient().from("gate_passes").insert({
      site_id: site, material_type_id: mat, reason: `CPL ${stamp}`, status: "issued", issued_by: gm.userId, stock_lot_id: lotId,
    }).select("id").single();
    expect(error, `pass: ${error?.message}`).toBeNull();
    return data!.id as string;
  };
  const ack = (passId: string) =>
    gate.client.from("gate_passes").update({ status: "acknowledged" }).eq("id", passId).select("id");

  // ── Approved runs are immutable ────────────────────────────────────────────
  it("1. approved run → extra INSERT refused", async () => {
    const runId = await approvedRun();
    const before = await snapshot(runId);
    for (const who of [inv, gm, owner]) {
      const r = await who.client.from("cost_price_run_extras").insert({ run_id: runId, material_name: "late", weight_kg: 1000, cost_price_per_kg: 999 });
      expect(r.error?.code, who.userId).toBe("CP001");
    }
    expect(await snapshot(runId)).toBe(before);
  });

  it("2. approved run → extra UPDATE refused, including moving an extra into it", async () => {
    const runId = await approvedRun();
    const extraId = (await adminClient().from("cost_price_run_extras").select("id").eq("run_id", runId).single()).data!.id as string;
    const other = await draft(inv, [], [{ kg: 400, cost: 500 }]);
    const otherExtra = (await adminClient().from("cost_price_run_extras").select("id").eq("run_id", other).single()).data!.id as string;
    const before = await snapshot(runId);

    // RLS already hides it from the author; the database refuses it for anyone who gets past RLS.
    expect((await inv.client.from("cost_price_run_extras").update({ cost_price_per_kg: 1 }).eq("id", extraId).select("id")).data ?? []).toHaveLength(0);
    expect((await adminClient().from("cost_price_run_extras").update({ cost_price_per_kg: 1 }).eq("id", extraId)).error?.code).toBe("CP001");
    // Before 0160 the WITH CHECK never looked at the destination run.
    expect((await inv.client.from("cost_price_run_extras").update({ run_id: runId }).eq("id", otherExtra)).error?.code).toBe("CP001");
    expect(await snapshot(runId)).toBe(before);
  });

  it("3. approved run → extra DELETE refused", async () => {
    const runId = await approvedRun();
    const extraId = (await adminClient().from("cost_price_run_extras").select("id").eq("run_id", runId).single()).data!.id as string;
    const before = await snapshot(runId);
    expect((await gm.client.from("cost_price_run_extras").delete().eq("id", extraId).select("id")).data ?? []).toHaveLength(0);
    expect((await adminClient().from("cost_price_run_extras").delete().eq("id", extraId)).error?.code).toBe("CP001");
    expect(await snapshot(runId)).toBe(before);
  });

  it("4. approved run → lot membership INSERT refused; the lot stays available", async () => {
    const runId = await approvedRun();
    const spare = await lot(300, 1000);
    const before = await snapshot(runId);
    const r = await inv.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: spare });
    expect(r.error?.code).toBe("CP001");
    expect(await lotStatus(spare)).toBe("available");
    expect(await snapshot(runId)).toBe(before);
  });

  it("5. approved run → lot membership UPDATE / reassignment refused", async () => {
    const runId = await approvedRun();
    const [link] = (await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", runId)).data!;
    const other = await draft(inv, [await lot()]);
    const before = await snapshot(runId);
    const admin = adminClient();
    expect((await admin.from("cost_price_run_lots").update({ run_id: other })
      .eq("run_id", runId).eq("stock_lot_id", link.stock_lot_id)).error?.code).toBe("CP001");
    expect((await admin.from("cost_price_run_lots").update({ stock_lot_id: await lot() })
      .eq("run_id", runId).eq("stock_lot_id", link.stock_lot_id)).error?.code).toBe("CP001");
    const otherLot = (await admin.from("cost_price_run_lots").select("stock_lot_id").eq("run_id", other).single()).data!.stock_lot_id;
    expect((await admin.from("cost_price_run_lots").update({ run_id: runId })
      .eq("run_id", other).eq("stock_lot_id", otherLot)).error?.code).toBe("CP001");
    expect(await snapshot(runId)).toBe(before);
  });

  it("6. approved run → lot membership DELETE refused", async () => {
    const runId = await approvedRun();
    const [link] = (await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", runId)).data!;
    const before = await snapshot(runId);
    expect((await inv.client.from("cost_price_run_lots").delete().eq("run_id", runId).eq("stock_lot_id", link.stock_lot_id).select("run_id")).data ?? []).toHaveLength(0);
    expect((await adminClient().from("cost_price_run_lots").delete().eq("run_id", runId).eq("stock_lot_id", link.stock_lot_id)).error?.code).toBe("CP001");
    expect(await snapshot(runId)).toBe(before);
  });

  it("7. protected parent financial and status UPDATE refused", async () => {
    const runId = await approvedRun();
    const before = await snapshot(runId);
    for (const patch of [
      { total_cost_price: 1 }, { total_weight_kg: 1 }, { avg_cost_price_per_kg: 1 },
      { approval_status: "rejected" }, { approval_status: "pending" }, { sold: false }, { label: "renamed" }, { site_id: site },
    ]) {
      const r = await owner.client.from("cost_price_runs").update(patch).eq("id", runId);
      if (JSON.stringify(patch) === JSON.stringify({ site_id: site })) {
        expect(r.error, "an update that changes nothing is not a change").toBeNull();
      } else {
        expect(r.error?.code, JSON.stringify(patch)).toBe("CP001");
      }
    }
    expect(await snapshot(runId)).toBe(before);
  });

  it("8. the owner cannot bypass: extras, lots, the run, and the sold lots it came from", async () => {
    const runId = await approvedRun();
    const [link] = (await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", runId)).data!;
    const before = await snapshot(runId);
    const o = owner.client;
    expect((await o.from("cost_price_run_extras").insert({ run_id: runId, material_name: "x", weight_kg: 1, cost_price_per_kg: 1 })).error?.code).toBe("CP001");
    expect((await o.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: await lot() })).error?.code).toBe("CP001");
    expect((await o.from("stock_lots").update({ cost_price_per_kg: 1 }).eq("id", link.stock_lot_id)).error?.code).toBe("CP001");
    expect((await o.from("stock_lots").update({ weight_kg: 1 }).eq("id", link.stock_lot_id)).error?.code).toBe("CP001");
    expect((await o.from("stock_lots").update({ status: "available" }).eq("id", link.stock_lot_id)).error?.code).toBe("CP001");
    expect((await o.from("cost_price_runs").update({ total_cost_price: 0 }).eq("id", runId)).error?.code).toBe("CP001");
    expect(await snapshot(runId)).toBe(before);
    // Fields the calculation never read are not frozen.
    const { data: s2 } = await adminClient().from("suppliers").insert({ name: `CPL merge ${stamp}` }).select("id").single();
    expect((await adminClient().from("stock_lots").update({ supplier_id: s2!.id }).eq("id", link.stock_lot_id)).error).toBeNull();
  });

  it("9. the general manager cannot bypass", async () => {
    const lots = [await lot(10, 10)];
    const runId = await draft(gm, lots);
    expect((await approve(runId)).error).toBeNull();
    const before = await snapshot(runId);
    expect((await gm.client.from("cost_price_run_extras").insert({ run_id: runId, material_name: "gm", weight_kg: 1, cost_price_per_kg: 1 })).error?.code).toBe("CP001");
    expect((await gm.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: await lot() })).error?.code).toBe("CP001");
    expect((await gm.client.from("cost_price_runs").update({ label: "gm" }).eq("id", runId).select("id")).data ?? []).toHaveLength(0);
    expect(await snapshot(runId)).toBe(before);
  });

  it("10. a service-role direct write cannot bypass, and nothing is born approved", async () => {
    const runId = await approvedRun();
    const [link] = (await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", runId)).data!;
    const before = await snapshot(runId);
    const admin = adminClient();
    expect((await admin.from("cost_price_run_extras").insert({ run_id: runId, material_name: "svc", weight_kg: 5, cost_price_per_kg: 5 })).error?.code).toBe("CP001");
    expect((await admin.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: await lot() })).error?.code).toBe("CP001");
    expect((await admin.from("cost_price_runs").update({ total_cost_price: 1 }).eq("id", runId)).error?.code).toBe("CP001");
    expect((await admin.from("cost_price_runs").delete().eq("id", runId)).error?.code).toBe("CP001");
    expect((await admin.from("stock_lots").update({ status: "available" }).eq("id", link.stock_lot_id)).error?.code).toBe("CP001");
    expect(await snapshot(runId)).toBe(before);

    for (const born of [{ approval_status: "approved" }, { approval_status: "pending", sold: true }, { approval_status: null, sold: true }]) {
      const r = await admin.from("cost_price_runs").insert({ site_id: site, label: `born ${stamp}`, created_by: inv.userId, ...born });
      expect(r.error?.code, JSON.stringify(born)).toBe("CP004");
    }
    const r = await inv.client.from("cost_price_runs").insert({ site_id: site, label: `born ${stamp}`, approval_status: "approved", sold: true, created_by: inv.userId });
    expect(r.error).not.toBeNull();
  });

  // ── Pending drafts ─────────────────────────────────────────────────────────
  it("11. a pending run's legitimate edits all land and the weighted cost follows", async () => {
    const a = await lot(100, 10), b = await lot(100, 30);
    const runId = await draft(inv, [a, b]);
    expect(Number((await runRow(runId)).avg_cost_price_per_kg)).toBe(20);

    expect((await inv.client.from("cost_price_runs").update({ label: "renamed draft" }).eq("id", runId).select("id")).data).toHaveLength(1);
    const { data: ex, error } = await inv.client.from("cost_price_run_extras")
      .insert({ run_id: runId, material_name: "Bought tin", weight_kg: 200, cost_price_per_kg: 50 }).select("id").single();
    expect(error).toBeNull();
    expect(Number((await runRow(runId)).avg_cost_price_per_kg)).toBe(35); // (1000+3000+10000)/400
    expect((await inv.client.from("cost_price_run_extras").update({ cost_price_per_kg: 10 }).eq("id", ex!.id).select("id")).data).toHaveLength(1);
    expect(Number((await runRow(runId)).avg_cost_price_per_kg)).toBe(15); // (1000+3000+2000)/400
    expect((await inv.client.from("cost_price_run_lots").delete().eq("run_id", runId).eq("stock_lot_id", b).select("run_id")).data).toHaveLength(1);
    expect((await inv.client.from("cost_price_run_extras").delete().eq("id", ex!.id).select("id")).data).toHaveLength(1);
    expect((await inv.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: b })).error).toBeNull();
    expect(Number((await runRow(runId)).avg_cost_price_per_kg)).toBe(20);
    expect((await runRow(runId)).approval_status).toBe("pending");

    // A rejected run and a saved computation are drafts too.
    expect((await reject(runId)).data).toHaveLength(1);
    expect((await inv.client.from("cost_price_run_extras").insert({ run_id: runId, material_name: "after reject", weight_kg: 1, cost_price_per_kg: 1 })).error).toBeNull();
    // … and a draft can still be deleted.
    expect((await inv.client.from("cost_price_runs").delete().eq("id", runId).select("id")).data).toHaveLength(1);
  });

  it("12. attaching an unavailable or reserved lot is refused", async () => {
    // sold: through an approved batch
    const soldRun = await approvedRun();
    const sold = (await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", soldRun).limit(1).single()).data!.stock_lot_id as string;
    // released: through the gate
    const released = await lot(20, 5);
    expect((await ack(await issuePass(released))).error).toBeNull();
    // on a live pass: leaving stock right now
    const onPass = await lot(20, 5);
    await issuePass(onPass);
    // reserved: in another pending run
    const reserved = await lot(20, 5);
    await draft(inv, [reserved]);

    const runId = await draft(inv, []);
    for (const [name, id, code] of [["sold", sold, "CP002"], ["released", released, "CP002"], ["on a live pass", onPass, "CP002"], ["reserved", reserved, "CP003"]] as const) {
      const r = await inv.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: id });
      expect(r.error?.code, name).toBe(code);
      expect(r.error!.message, `${name}: no lot id`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
    expect((await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", runId)).data).toHaveLength(0);

    // A saved computation reserves nothing and may use a reserved lot — but still only an available one.
    const calc = await draft(inv, [], [], null);
    expect((await inv.client.from("cost_price_run_lots").insert({ run_id: calc, stock_lot_id: reserved })).error).toBeNull();
    expect((await inv.client.from("cost_price_run_lots").insert({ run_id: calc, stock_lot_id: sold })).error?.code).toBe("CP002");
    // … and it cannot be turned into a pending batch while that lot is reserved elsewhere.
    expect((await inv.client.from("cost_price_runs").update({ approval_status: "pending" }).eq("id", calc)).error?.code).toBe("CP003");
  });

  // ── Reservation lifecycle (ruling: at most one PENDING run per lot) ────────
  const reserve = (who: TestUser, runId: string, lotId: string) =>
    who.client.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: lotId });
  const unreserve = (who: TestUser, runId: string, lotId: string) =>
    who.client.from("cost_price_run_lots").delete().eq("run_id", runId).eq("stock_lot_id", lotId).select("run_id");
  const statusesOf = async (ids: string[]) =>
    JSON.stringify((await adminClient().from("stock_lots").select("id, status").in("id", ids).order("id")).data);

  it("RA. a pending run reserves its lot: a second pending run is refused CP003", async () => {
    const X = await lot(10, 10);
    const A = await draft(inv, [X]);
    const B = await draft(gm, []);
    const r = await reserve(gm, B, X);
    expect(r.error?.code).toBe("CP003");
    expect(r.error!.message).toBe("That lot is already in another batch awaiting approval.");
    expect((await adminClient().from("cost_price_run_lots").select("run_id").eq("stock_lot_id", X)).data).toEqual([{ run_id: A }]);
  });

  it("RB. removing the lot from pending run A releases it: pending run B may now attach it", async () => {
    const X = await lot(10, 10);
    const A = await draft(inv, [X]);
    const B = await draft(gm, []);
    expect((await reserve(gm, B, X)).error?.code).toBe("CP003");
    const before = await statusesOf([X]);
    expect((await unreserve(inv, A, X)).data).toHaveLength(1);
    expect((await reserve(gm, B, X)).error).toBeNull();
    expect(await statusesOf([X]), "no stock status was touched to release it").toBe(before);
    expect(await lotStatus(X)).toBe("available");
  });

  it("RC. rejecting pending run A releases its reservations, and rejection changes nothing else", async () => {
    const X = await lot(10, 10), Y = await lot(20, 30);
    const A = await draft(inv, [X, Y], [{ kg: 5, cost: 7 }]);
    const approvedElsewhere = await approvedRun();
    const approvedBefore = await snapshot(approvedElsewhere);
    const links = async () => JSON.stringify((await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", A).order("stock_lot_id")).data);
    const extras = async () => JSON.stringify((await adminClient().from("cost_price_run_extras").select("*").eq("run_id", A).order("id")).data);
    const [linksBefore, extrasBefore, lotsBefore, outsBefore, rowBefore] =
      [await links(), await extras(), await statusesOf([X, Y]), await mixedOuts(), await runRow(A)];
    const passesBefore = (await adminClient().from("gate_passes").select("id", { count: "exact", head: true }).in("stock_lot_id", [X, Y])).count;

    expect((await reject(A)).data).toHaveLength(1);

    const rowAfter = await runRow(A);
    expect(rowAfter.approval_status).toBe("rejected");
    expect(rowAfter.sold).toBe(false);
    for (const k of ["total_weight_kg", "total_cost_price", "avg_cost_price_per_kg", "label", "site_id", "batch_code"] as const) {
      expect(rowAfter[k], `run row kept: ${k}`).toEqual(rowBefore[k]);
    }
    expect(await links(), "memberships kept").toBe(linksBefore);
    expect(await extras(), "extras kept").toBe(extrasBefore);
    expect(await statusesOf([X, Y]), "no stock lot changed").toBe(lotsBefore);
    expect(await mixedOuts(), "no stock movement").toBe(outsBefore);
    expect((await adminClient().from("gate_passes").select("id", { count: "exact", head: true }).in("stock_lot_id", [X, Y])).count).toBe(passesBefore);
    expect(await snapshot(approvedElsewhere), "approved history untouched").toBe(approvedBefore);

    // … and the reservation is gone.
    const B = await draft(gm, []);
    expect((await reserve(gm, B, X)).error).toBeNull();
  });

  it("RD. a saved computation holding a lot does not reserve it", async () => {
    const X = await lot(10, 10);
    const calc = await draft(inv, [X], [], null);
    const B = await draft(gm, []);
    expect((await reserve(gm, B, X)).error).toBeNull();
    // … and a computation may also include a lot a pending run holds.
    const calc2 = await draft(inv, [], [], null);
    expect((await reserve(inv, calc2, X)).error).toBeNull();
    expect((await runRow(calc)).approval_status).toBeNull();
  });

  it("RE. a rejected run holding a lot does not reserve it", async () => {
    const X = await lot(10, 10);
    const A = await draft(inv, [X]);
    expect((await reject(A)).data).toHaveLength(1);
    const B = await draft(gm, []);
    expect((await reserve(gm, B, X)).error).toBeNull();
    // A lot added to the rejected draft later reserves nothing either.
    const Z = await lot(10, 10);
    expect((await reserve(inv, A, Z)).error).toBeNull();
    const C = await draft(gm, []);
    expect((await reserve(gm, C, Z)).error).toBeNull();
  });

  it("RF. putting a run back to pending while one of its lots is reserved elsewhere is refused cleanly", async () => {
    const X = await lot(10, 10), W = await lot(10, 10);
    const A = await draft(inv, [X, W]);
    expect((await reject(A)).data).toHaveLength(1);
    const B = await draft(gm, [X]);
    const rowBefore = await runRow(A);

    const r = await inv.client.from("cost_price_runs").update({ approval_status: "pending" }).eq("id", A).select("id");
    expect(r.error?.code).toBe("CP003");
    expect((await runRow(A)).approval_status, "A stays rejected").toBe("rejected");
    expect(JSON.stringify(await runRow(A)), "and nothing on it changed").toBe(JSON.stringify(rowBefore));
    expect(await statusesOf([X, W])).toBe(JSON.stringify([X, W].sort().map((id) => ({ id, status: "available" }))));
    // Owner and service role meet the same refusal.
    expect((await owner.client.from("cost_price_runs").update({ approval_status: "pending" }).eq("id", A)).error?.code).toBe("CP003");
    expect((await adminClient().from("cost_price_runs").update({ approval_status: "pending" }).eq("id", A)).error?.code).toBe("CP003");
    // Once B lets go, A may be re-pended.
    expect((await unreserve(gm, B, X)).data).toHaveLength(1);
    expect((await inv.client.from("cost_price_runs").update({ approval_status: "pending" }).eq("id", A).select("id")).data).toHaveLength(1);
  });

  it("RR. reservation release vs a competing reservation at the same instant: never two pending holders, no deadlock", async () => {
    for (let i = 0; i < REPEAT; i++) {
      for (const release of ["reject", "remove"] as const) {
        const X = await lot(10, 10);
        const A = await draft(inv, [X]);
        const B = await draft(gm, []);
        const [rel, att] = await Promise.all([
          release === "reject" ? reject(A) : unreserve(inv, A, X),
          reserve(gm, B, X),
        ]);
        expect(rel.error, `${release} ${i}: ${rel.error?.message}`).toBeNull();
        expect(rel.data, `${release} ${i}`).toHaveLength(1);
        expect(att.error?.code, `${release} ${i}`).not.toBe(DEADLOCK);
        if (att.error) expect(att.error.code, `${release} ${i}`).toBe("CP003");
        // Whatever the order, once A has genuinely released, B can hold it — exactly once.
        if (att.error) expect((await reserve(gm, B, X)).error, `${release} ${i}: retry after release`).toBeNull();
        const holders = (await adminClient().from("cost_price_run_lots").select("run_id, run:cost_price_runs(approval_status)")
          .eq("stock_lot_id", X)).data ?? [];
        const pendingHolders = holders.filter((h) => (h.run as unknown as { approval_status: string }).approval_status === "pending");
        expect(pendingHolders.map((h) => h.run_id), `${release} ${i}: one pending holder`).toEqual([B]);
      }
    }
  }, 180_000);

  it("13. a lot sold through another batch makes a pending draft unapprovable until it is removed", async () => {
    // The only way left for one lot to be in a pending draft and sold elsewhere:
    // the draft is rejected, the lot is sold, and the draft is put back to pending.
    const L = await lot(100, 40), keep = await lot(50, 20);
    const stale = await draft(inv, [L, keep]);
    expect((await reject(stale)).data).toHaveLength(1);
    const other = await draft(gm, [L]);
    expect((await approve(other)).error).toBeNull();
    expect(await lotStatus(L)).toBe("sold");
    expect((await inv.client.from("cost_price_runs").update({ approval_status: "pending" }).eq("id", stale).select("id")).data).toHaveLength(1);

    const outs = await mixedOuts();
    const res = await approve(stale);
    expect(res.error?.code).toBe("CP002");
    expect(res.error!.message).toBe("One or more selected lots are no longer available. Refresh the run before approving it.");
    expect((await runRow(stale)).approval_status, "the run stays pending").toBe("pending");
    expect(await lotStatus(keep), "no partial sale").toBe("available");
    expect(await mixedOuts(), "no stock movement").toBe(outs);
    expect((await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", stale)).data, "membership kept, visibly").toHaveLength(2);

    // The repair is the existing Remove action; then the draft approves on what is left.
    expect((await inv.client.from("cost_price_run_lots").delete().eq("run_id", stale).eq("stock_lot_id", L).select("run_id")).data).toHaveLength(1);
    expect((await approve(stale)).error).toBeNull();
    const row = await runRow(stale);
    expect(Number(row.total_weight_kg)).toBe(50);
    expect(Number(row.avg_cost_price_per_kg)).toBe(20);
    expect(await lotStatus(keep)).toBe("sold");
  });

  it("14. a lot released through the gate cannot be approved", async () => {
    const L = await lot(30, 10), keep = await lot(30, 10);
    const runId = await draft(inv, [L, keep]);
    expect((await ack(await issuePass(L))).error).toBeNull();
    expect(await lotStatus(L)).toBe("released");
    const res = await approve(runId);
    expect(res.error?.code).toBe("CP002");
    expect((await runRow(runId)).approval_status).toBe("pending");
    expect(await lotStatus(L)).toBe("released");
    expect(await lotStatus(keep)).toBe("available");
  });

  it("15. a stale editor holding the pending page cannot touch the run once it is approved", async () => {
    const a = await lot(100, 50), b = await lot(200, 80), spare = await lot(10, 10);
    const runId = await draft(inv, [a, b], [{ kg: 100, cost: 20 }]);
    const extraId = (await adminClient().from("cost_price_run_extras").select("id").eq("run_id", runId).single()).data!.id as string;
    // The editor loaded while pending. Another session approves.
    expect((await approve(runId)).error).toBeNull();
    const before = await snapshot(runId);

    const c = inv.client;
    const attempts = {
      addExtra: await c.from("cost_price_run_extras").insert({ run_id: runId, material_name: "stale", weight_kg: 1000, cost_price_per_kg: 999 }),
      editExtra: await c.from("cost_price_run_extras").update({ cost_price_per_kg: 1 }).eq("id", extraId).select("id"),
      deleteExtra: await c.from("cost_price_run_extras").delete().eq("id", extraId).select("id"),
      attachLot: await c.from("cost_price_run_lots").insert({ run_id: runId, stock_lot_id: spare }),
      removeLot: await c.from("cost_price_run_lots").delete().eq("run_id", runId).eq("stock_lot_id", a).select("run_id"),
      rename: await c.from("cost_price_runs").update({ label: "stale" }).eq("id", runId).select("id"),
      total: await owner.client.from("cost_price_runs").update({ total_cost_price: 1 }).eq("id", runId).select("id"),
    };
    for (const [name, r] of Object.entries(attempts)) {
      const refused = r.error?.code === "CP001" || (!r.error && ((r as { data: unknown[] | null }).data ?? []).length === 0);
      expect(refused, `${name}: ${r.error?.code} ${r.error?.message}`).toBe(true);
    }
    expect(attempts.addExtra.error?.code).toBe("CP001");
    expect(attempts.attachLot.error?.code).toBe("CP001");
    expect(attempts.total.error?.code).toBe("CP001");
    expect(await snapshot(runId), "17. byte-identical after every refused write").toBe(before);
    expect(await lotStatus(spare)).toBe("available");
  });

  it("16. approval computes from the locked current lot values, not the draft's last stored totals", async () => {
    const a = await lot(100, 10), b = await lot(100, 30);
    const runId = await draft(inv, [a, b], [{ kg: 200, cost: 5 }]);
    expect(Number((await runRow(runId)).total_cost_price)).toBe(5000);
    // The lot's cost is corrected while the draft waits; nothing recomputes the draft.
    expect((await owner.client.from("stock_lots").update({ cost_price_per_kg: 70 }).eq("id", b)).error).toBeNull();
    expect(Number((await runRow(runId)).total_cost_price), "the stored draft total is stale").toBe(5000);

    expect((await approve(runId)).error).toBeNull();
    const row = await runRow(runId);
    expect(Number(row.total_weight_kg)).toBe(400);
    expect(Number(row.total_cost_price)).toBe(9000); // 1000 + 7000 + 1000
    expect(Number(row.avg_cost_price_per_kg)).toBe(22.5);
    expect(row.sold).toBe(true);
    expect(row.approved_at).not.toBeNull();
  });

  it("approval happens once, from pending, and needs a stock lot", async () => {
    const calc = await draft(inv, [await lot(10, 10)], [], null);
    expect((await owner.client.from("cost_price_runs").update({ approval_status: "approved" }).eq("id", calc)).error?.code).toBe("CP004");
    const rejected = await draft(inv, [await lot(10, 10)]);
    expect((await reject(rejected)).data).toHaveLength(1);
    expect((await owner.client.from("cost_price_runs").update({ approval_status: "approved" }).eq("id", rejected)).error?.code).toBe("CP004");

  });

  it("CP005. an extras-only pending run cannot be approved by anyone", async () => {
    const empty = await draft(inv, [], [{ kg: 5, cost: 5 }]);
    const outs = await mixedOuts();
    const rowBefore = JSON.stringify(await runRow(empty));
    const extrasBefore = JSON.stringify((await adminClient().from("cost_price_run_extras").select("*").eq("run_id", empty)).data);
    const attempts = {
      owner: await approve(empty, owner),
      gm: await approve(empty, gm),
      inventory: await approve(empty, inv),
      serviceRole: await adminClient().from("cost_price_runs").update({ approval_status: "approved" }).eq("id", empty).select("id"),
    };
    // Approval is the owner's (RLS: "cost_price_runs: owner approves"), and since
    // 0162 it runs through a review RPC that says so before it gets as far as the
    // empty-sale rule. GM and inventory previously reached CP005 only because a
    // BEFORE trigger fires ahead of the WITH CHECK that would have refused them;
    // the effective authority is unchanged.
    for (const [who, r] of Object.entries(attempts)) {
      expect(r.error, `${who} must be refused`).not.toBeNull();
      if (who === "owner") {
        expect(r.error?.code, `${who}: ${r.error?.message}`).toBe("CP005");
        expect(r.error!.message).toBe("A batch needs at least one stock lot before it can be approved.");
      } else if (who === "serviceRole") {
        // A direct table UPDATE names no reviewed version, so since 0162 it is
        // refused before CP005 is even reached — there is no longer any
        // approval path that does not say what it reviewed.
        expect(r.error?.code, `${who}: ${r.error?.message}`).toBe("ST001");
      }
    }
    expect(JSON.stringify(await runRow(empty)), "nothing on the run changed").toBe(rowBefore);
    expect(JSON.stringify((await adminClient().from("cost_price_run_extras").select("*").eq("run_id", empty)).data)).toBe(extrasBefore);
    expect(await mixedOuts(), "no movement").toBe(outs);

    // A saved computation and a pending draft with no lots may still exist.
    expect(await draft(inv, [], [{ kg: 1, cost: 1 }], null)).toBeTruthy();
    expect(await draft(inv, [], [])).toBeTruthy();
    // With a lot the GM and inventory still cannot approve — that is the owner's (RLS).
    const withLot = await draft(inv, [await lot(10, 10)]);
    for (const who of [gm, inv]) {
      const r = await approve(withLot, who);
      expect(r.error, `${who.userId} cannot approve`).not.toBeNull();
    }
    expect((await runRow(withLot)).approval_status).toBe("pending");
  });

  it("every refusal the screens map is a fixed sentence with no identifiers", () => {
    for (const code of ["CP001", "CP002", "CP003", "CP004", "CP005"]) {
      const s = costPriceRefusal(code);
      expect(s, code).toBeTruthy();
      expect(s!).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|cost_price|stock_lots|SQLSTATE|trigger/i);
    }
    expect(costPriceRefusal("P0001")).toBeNull();
  });

  // ── Concurrency (HTTP, repeated) ───────────────────────────────────────────
  it("C2. approval vs gate release of the same lot: exactly one wins, one deduction, no deadlock", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot(40, 10);
      const runId = await draft(inv, [L]);
      const passId = await issuePass(L);
      const outs = await mixedOuts();
      const [s, a] = await Promise.all([approve(runId), ack(passId)]);
      expect(s.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(a.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      // The pass was live when both started, so the sale is refused either way.
      expect(a.error, `iteration ${i}: release ${a.error?.message}`).toBeNull();
      // 0162 adds a third correct refusal: the release moved the lot after the
      // owner read the run, so the run they reviewed no longer exists.
      expect(["GP007", "CP002", "ST001"], `iteration ${i}: ${s.error?.code}`).toContain(s.error?.code);
      expect(await lotStatus(L)).toBe("released");
      expect(await mixedOuts(), `iteration ${i}: no sale deduction`).toBe(outs);
      expect((await runRow(runId)).approval_status).toBe("pending");
    }
  }, 120_000);

  it("C3. approval vs a stale extra insert: the extra lands in the draft before approval or is refused after", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const runId = await draft(inv, [await lot(100, 10)]);
      const [s, e] = await Promise.all([
        approve(runId),
        inv.client.from("cost_price_run_extras").insert({ run_id: runId, material_name: "race", weight_kg: 100, cost_price_per_kg: 30 }),
      ]);
      const row = await runRow(runId);
      if (s.error) {
        // 0162: the extra landed after the owner read the run, so the approval is
        // refused rather than silently approving a more expensive batch.
        expect(s.error.code, `iteration ${i}: ${s.error.message}`).toBe("ST001");
        expect(e.error, `iteration ${i}: the extra is what changed`).toBeNull();
        expect(row.approval_status, `iteration ${i}: still pending`).toBe("pending");
      } else if (e.error) {
        expect(e.error.code, `iteration ${i}`).toBe("CP001");
        expect(Number(row.total_cost_price)).toBe(1000);
      } else {
        // it committed first, so the approval recomputed with it
        expect(Number(row.total_cost_price)).toBe(4000);
      }
      const extras = (await adminClient().from("cost_price_run_extras").select("id").eq("run_id", runId)).data ?? [];
      expect(extras.length).toBe(e.error ? 0 : 1);
    }
  }, 120_000);

  it("C4. two drafts reserving the same lot at the same instant: exactly one holds it", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot(10, 10);
      const [p, q] = [await draft(inv, []), await draft(gm, [])];
      const [x, y] = await Promise.all([
        inv.client.from("cost_price_run_lots").insert({ run_id: p, stock_lot_id: L }),
        gm.client.from("cost_price_run_lots").insert({ run_id: q, stock_lot_id: L }),
      ]);
      for (const r of [x, y]) expect(r.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect([x, y].filter((r) => !r.error), `iteration ${i}`).toHaveLength(1);
      expect([x, y].find((r) => r.error)!.error!.code).toBe("CP003");
    }
  }, 120_000);

  it("C5. the same batch approved twice at once: one approval, one sale", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot(10, 10);
      const runId = await draft(inv, [L]);
      const outs = await mixedOuts();
      const [x, y] = await Promise.all([approve(runId), approve(runId)]);
      // 0162: the loser no longer returns zero rows silently — it is refused
      // ST001 because the run it reviewed has already been ruled on.
      expect([x.error, y.error].filter((e) => e === null),
        `iteration ${i}: exactly one approval`).toHaveLength(1);
      expect([x.error, y.error].filter((e) => e?.code === "ST001"),
        `iteration ${i}: the loser is refused as stale`).toHaveLength(1);
      expect(await mixedOuts()).toBe(outs + 1);
      expect(await lotStatus(L)).toBe("sold");
    }
  }, 120_000);
});
