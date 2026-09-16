import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * 0155 — a lot-linked gate pass releases its lot once, and only once.
 *
 * Audit 3E-7A proved every one of these against the local stack (whose trigger
 * and policy source hashes match production):
 *   • two live passes on one lot, even issued at the same instant;
 *   • acknowledging each wrote a 'gate_release' for the PASS weight and never
 *     touched the lot, which stayed 'available' — re-passable, sellable, valued;
 *   • a sold lot could still be released, and a released lot still sold;
 *   • the gate could self-authorise a request and edit a pass's weight (5 → 400
 *     kg) or lot before acknowledging it.
 *
 * Rulings (3E-7B): a lot-linked pass is a non-sale release from stock. Its
 * acknowledgement writes exactly one out for the lot's own weight and turns the
 * lot 'released', atomically; a lot on a live pass cannot be sold; a sold lot
 * cannot be put on a pass.
 *
 * Concurrency is exercised with genuinely separate sessions firing together,
 * repeated, rather than simulated in sequence.
 */

const LIVE = ["pending", "issued", "acknowledged"];
const DEADLOCK = "40P01";
const REPEAT = 6;
const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

describe("lot-linked gate passes release a lot once (0155)", () => {
  const stamp = Date.now();
  let NS: string, OS: string, mat: string, sup: string;
  let owner: TestUser, gm: TestUser, gm2: TestUser, mgrOld: TestUser;
  let gate: TestUser, gate2: TestUser, recvOld: TestUser;

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    NS = sites!.find((s) => s.name === "New-Site")!.id as string;
    OS = sites!.find((s) => s.name === "Old-Site")!.id as string;
    // Its own material, so these stock buckets are nobody else's.
    mat = (await admin.from("material_types").insert({ name: `GPSI ${stamp}` }).select("id").single()).data!.id as string;
    sup = (await admin.from("suppliers").insert({ name: `GPSI ${stamp}` }).select("id").single()).data!.id as string;

    owner = await makeUser({ username: `gpsi-own-${stamp}`, role: "owner", siteId: null });
    gm = await makeUser({ username: `gpsi-gm-${stamp}`, role: "manager", siteId: NS });
    gm2 = await makeUser({ username: `gpsi-gm-${stamp}`, role: "manager", siteId: NS }); // second session
    mgrOld = await makeUser({ username: `gpsi-mo-${stamp}`, role: "manager", siteId: OS });
    gate = await makeUser({ username: `gpsi-gate-${stamp}`, role: "gate", siteId: NS });
    gate2 = await makeUser({ username: `gpsi-gate-${stamp}`, role: "gate", siteId: NS }); // second session
    recvOld = await makeUser({ username: `gpsi-rcv-${stamp}`, role: "receiving", siteId: OS });

    // Plenty in both buckets, so the balance guard never decides an outcome here.
    for (const site of [NS, OS]) {
      const { error } = await admin.from("stock_movements").insert({
        site_id: site, material_type_id: mat, weight: 100000, direction: "in",
        reason: "purchase_intake", recorded_by: owner.userId,
      });
      expect(error, `bucket seed: ${error?.message}`).toBeNull();
    }
  });

  // ── fixtures ──────────────────────────────────────────────────────────────
  const lot = async (site = NS, kg = 10, extra: Record<string, unknown> = {}, material = mat) => {
    const { data, error } = await adminClient().from("stock_lots").insert({
      site_id: site, material_type_id: material, supplier_id: sup, weight_kg: kg,
      cost_price_per_kg: 100, status: "available", ...extra,
    }).select("id").single();
    expect(error, `lot fixture: ${error?.message}`).toBeNull();
    return data!.id as string;
  };
  const passRow = (by: TestUser, site: string, lotId: string | null, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    site_id: site, supplier_id: sup, material_type_id: lotId ? null : mat, stock_lot_id: lotId,
    weight_kg: null, reason: `GPSI ${stamp}`, issued_by: by.userId,
    status: "issued", authorized_by: by.userId, authorized_at: new Date().toISOString(), ...over,
  });
  const issue = (by: TestUser, lotId: string, over: Record<string, unknown> = {}, site = NS) =>
    by.client.from("gate_passes").insert(passRow(by, site, lotId, over)).select("id, weight_kg, status").single();
  const ack = (who: TestUser, id: string) =>
    who.client.from("gate_passes").update({ status: "acknowledged" }).eq("id", id).select("id");
  const cancel = (who: TestUser, id: string) =>
    who.client.from("gate_passes").update({ status: "cancelled" }).eq("id", id).select("id");

  const livePasses = async (lotId: string) =>
    (await adminClient().from("gate_passes").select("id", { count: "exact", head: true })
      .eq("stock_lot_id", lotId).in("status", LIVE)).count ?? 0;
  const releasesFor = async (passId: string) =>
    (await adminClient().from("stock_movements").select("weight, gate_pass_id")
      .eq("gate_pass_id", passId).eq("reason", "gate_release")).data ?? [];
  const lotStatus = async (lotId: string) =>
    (await adminClient().from("stock_lots").select("status").eq("id", lotId).single()).data!.status as string;
  const outs = async (reason: string) =>
    (await adminClient().from("stock_movements").select("id", { count: "exact", head: true })
      .eq("material_type_id", mat).eq("reason", reason)).count ?? 0;

  const runFor = async (lotIds: string[], site = NS) => {
    const admin = adminClient();
    const { data, error } = await admin.from("cost_price_runs").insert({
      site_id: site, label: `GPSI ${stamp} ${Math.random()}`, material_type_id: mat,
      approval_status: "pending", sold: true, created_by: owner.userId,
    }).select("id").single();
    expect(error, `run fixture: ${error?.message}`).toBeNull();
    await admin.from("cost_price_run_lots").insert(lotIds.map((id) => ({ run_id: data!.id, stock_lot_id: id })));
    return data!.id as string;
  };
  const approve = (runId: string) =>
    owner.client.from("cost_price_runs").update({
      approval_status: "approved", approved_by: owner.userId, sold: true, sold_at: new Date().toISOString(),
    }).eq("id", runId).select("id");

  // ── One live pass per lot ─────────────────────────────────────────────────
  it("1. the first lot-linked pass is accepted", async () => {
    const L = await lot();
    const { data, error } = await issue(gm, L);
    expect(error, `issue: ${error?.message}`).toBeNull();
    expect(data!.status).toBe("issued");
    expect(await livePasses(L)).toBe(1);
  });

  it("2. a second live pass on the same lot is refused", async () => {
    const L = await lot();
    expect((await issue(gm, L)).error).toBeNull();
    const second = await issue(gm, L);
    expect(second.error, "the second pass must be refused").not.toBeNull();
    expect(second.error!.code).toBe("23505");
    expect(await livePasses(L)).toBe(1);
  });

  it("3. two issues at the same instant leave exactly one live pass", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot();
      const results = await Promise.all([issue(gm, L), issue(gm2, L)]);
      const oks = results.filter((r) => !r.error);
      expect(oks, `iteration ${i}: exactly one issue wins`).toHaveLength(1);
      for (const r of results.filter((r) => r.error)) expect(r.error!.code).toBe("23505");
      expect(await livePasses(L)).toBe(1);
    }
  }, 60_000);

  it("4. cancelling a pass frees the lot for a reissue", async () => {
    const L = await lot();
    const first = await issue(gm, L);
    expect((await cancel(gm, first.data!.id as string)).data ?? []).toHaveLength(1);
    const again = await issue(gm, L);
    expect(again.error, `reissue: ${again.error?.message}`).toBeNull();
    expect(await livePasses(L)).toBe(1);
  });

  // ── The lot decides the weight ────────────────────────────────────────────
  it("5. a lot-linked pass carries the lot's exact weight, whatever was sent", async () => {
    const L = await lot(NS, 10);
    const { data } = await issue(gm, L, { weight_kg: 3 });
    expect(Number(data!.weight_kg)).toBe(10);
  });

  it("6. an oversized weight cannot survive", async () => {
    const L = await lot(NS, 10);
    const { data } = await issue(gm, L, { weight_kg: 999 });
    const { data: row } = await adminClient().from("gate_passes").select("weight_kg").eq("id", data!.id).single();
    expect(Number(row!.weight_kg)).toBe(10);
  });

  // ── Which lots may go on a pass ───────────────────────────────────────────
  it("7. a sold lot cannot go on a pass", async () => {
    const L = await lot(NS, 10, { status: "sold" });
    const { error } = await issue(gm, L);
    expect(error?.code).toBe("GP001");
    expect(await livePasses(L)).toBe(0);
  });

  it("8. another site's lot cannot go on a pass", async () => {
    const L = await lot(OS);
    const { error } = await issue(gm, L); // pass on New-Site, lot on Old-Site
    expect(error?.code).toBe("GP002");
    expect(await livePasses(L)).toBe(0);
  });

  // ── Frozen identity ───────────────────────────────────────────────────────
  it("9. nobody — the gate included — can re-point a pass at another lot", async () => {
    const L1 = await lot(); const L2 = await lot();
    const { data } = await issue(gm, L1);
    for (const who of [gate, owner]) {
      const res = await who.client.from("gate_passes").update({ stock_lot_id: L2 }).eq("id", data!.id).select("id");
      expect(res.error?.code, "re-pointing must be refused").toBe("GP004");
    }
    const { data: row } = await adminClient().from("gate_passes").select("stock_lot_id").eq("id", data!.id).single();
    expect(row!.stock_lot_id).toBe(L1);
  });

  it("10. nobody — the gate included — can change a pass's weight", async () => {
    const L = await lot(NS, 5);
    const { data } = await issue(gm, L);
    for (const who of [gate, owner]) {
      const res = await who.client.from("gate_passes").update({ weight_kg: 400 }).eq("id", data!.id).select("id");
      expect(res.error?.code, "weight edit must be refused").toBe("GP004");
    }
    const { data: row } = await adminClient().from("gate_passes").select("weight_kg").eq("id", data!.id).single();
    expect(Number(row!.weight_kg)).toBe(5);
  });

  // ── Authorisation ─────────────────────────────────────────────────────────
  it("11. the gate cannot authorise a request by UPDATE", async () => {
    const L = await lot();
    const { data: pend } = await adminClient().from("gate_passes")
      .insert(passRow(gm, NS, L, { status: "pending", authorized_by: null, authorized_at: null, requested_by: gm.userId }))
      .select("id").single();
    const res = await gate.client.from("gate_passes").update({ status: "issued" }).eq("id", pend!.id).select("id");
    expect(res.error?.code, "self-authorisation must be refused").toBe("GP005");
    const { data: row } = await adminClient().from("gate_passes").select("status").eq("id", pend!.id).single();
    expect(row!.status).toBe("pending");
  });

  it("12. a site manager (RPC) and the GM (direct) still authorise; the lot is re-checked", async () => {
    // Receiving raises an own-site, lot-linked request; its site's manager signs it off.
    const L = await lot(OS);
    const req = await recvOld.client.from("gate_passes")
      .insert(passRow(recvOld, OS, L, { status: "pending", authorized_by: null, authorized_at: null, requested_by: recvOld.userId }))
      .select("id").single();
    expect(req.error, `receiving request: ${req.error?.message}`).toBeNull();
    expect((await recvOld.client.rpc("authorize_gate_pass", { p_pass_id: req.data!.id } as never)).error,
      "receiving still cannot authorise").not.toBeNull();
    expect((await mgrOld.client.rpc("authorize_gate_pass", { p_pass_id: req.data!.id } as never)).error).toBeNull();
    expect((await adminClient().from("gate_passes").select("status").eq("id", req.data!.id).single()).data!.status).toBe("issued");

    // The GM's direct UPDATE path is unchanged.
    const L2 = await lot();
    const { data: pend } = await adminClient().from("gate_passes")
      .insert(passRow(gm, NS, L2, { status: "pending", authorized_by: null, authorized_at: null }))
      .select("id").single();
    expect((await gm.client.from("gate_passes").update({ status: "issued" }).eq("id", pend!.id).select("id")).error).toBeNull();

    // A request whose lot left stock meanwhile cannot be authorised.
    const L3 = await lot(OS);
    const stale = await recvOld.client.from("gate_passes")
      .insert(passRow(recvOld, OS, L3, { status: "pending", authorized_by: null, authorized_at: null, requested_by: recvOld.userId }))
      .select("id").single();
    await adminClient().from("stock_lots").update({ status: "sold" }).eq("id", L3);
    expect((await mgrOld.client.rpc("authorize_gate_pass", { p_pass_id: stale.data!.id } as never)).error).not.toBeNull();
    expect((await adminClient().from("gate_passes").select("status").eq("id", stale.data!.id).single()).data!.status).toBe("pending");
  });

  // ── Acknowledgement ───────────────────────────────────────────────────────
  it("13. acknowledging releases the lot: one movement, the lot's weight, traced, lot released", async () => {
    const L = await lot(NS, 10);
    const { data } = await issue(gm, L, { weight_kg: 3 });
    const res = await ack(gate, data!.id as string);
    expect(res.error, `ack: ${res.error?.message}`).toBeNull();
    const rel = await releasesFor(data!.id as string);
    expect(rel, "exactly one gate_release").toHaveLength(1);
    expect(Number(rel[0].weight), "the lot's weight, not the pass input").toBe(10);
    expect(rel[0].gate_pass_id).toBe(data!.id);
    expect(await lotStatus(L)).toBe("released");
  });

  it("14. acknowledging the same pass again writes nothing more", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await ack(gate, data!.id as string);
    const again = await ack(gate, data!.id as string);
    expect(again.error, "a retry is a no-op, not an error").toBeNull();
    expect(await releasesFor(data!.id as string)).toHaveLength(1);
  });

  it("15. two acknowledgements of one pass at the same instant write one movement", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot();
      const { data } = await issue(gm, L);
      const results = await Promise.all([ack(gate, data!.id as string), ack(gate2, data!.id as string)]);
      for (const r of results) expect(r.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(await releasesFor(data!.id as string), `iteration ${i}: one movement`).toHaveLength(1);
      expect(await lotStatus(L)).toBe("released");
    }
  }, 60_000);

  it("16. the duplicate-pass path is closed, down to the ledger", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await ack(gate, data!.id as string);
    const second = await issue(gm, L);
    expect(second.error, "a released lot cannot take another pass").not.toBeNull();
    const { count } = await adminClient().from("gate_passes").select("id", { count: "exact", head: true }).eq("stock_lot_id", L);
    expect(count, "only the one pass ever existed").toBe(1);
    // Schema-level backstop: a second release for the same pass cannot be written.
    const dup = await adminClient().from("stock_movements").insert({
      site_id: NS, material_type_id: mat, weight: 10, direction: "out", reason: "gate_release",
      recorded_by: owner.userId, gate_pass_id: data!.id,
    });
    expect(dup.error?.code).toBe("23505");
  });

  it("a failed release changes nothing: pass, ledger and lot all stay put", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await adminClient().from("stock_lots").update({ status: "sold" }).eq("id", L); // out from under the pass
    const res = await ack(gate, data!.id as string);
    expect(res.error?.code).toBe("GP006");
    expect((await adminClient().from("gate_passes").select("status").eq("id", data!.id).single()).data!.status).toBe("issued");
    expect(await releasesFor(data!.id as string)).toHaveLength(0);
    expect(await lotStatus(L)).toBe("sold");
  });

  // ── Sale guard ────────────────────────────────────────────────────────────
  it("17. a released lot cannot be sold", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await ack(gate, data!.id as string);
    const before = await outs("mixed_batch");
    const res = await approve(await runFor([L]));
    expect(res.error, "selling a released lot must be refused").not.toBeNull();
    expect(await lotStatus(L)).toBe("released");
    expect(await outs("mixed_batch")).toBe(before);
  });

  it("17b. that refusal reaches the operator without the lot id, and without claiming it was sold", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await ack(gate, data!.id as string);
    const res = await approve(await runFor([L]));
    // What the database says — and why the action must not pass it through.
    expect(res.error?.code).toBe("P0001");
    expect(res.error!.message).toMatch(/already left stock/);
    expect(res.error!.message, "the raw refusal carries the lot's id").toContain(L);
    expect(res.error!.message, "and wrongly says sold for a released lot").toMatch(/sold elsewhere/);

    // What the operator gets instead, mapped before the raw pass-through.
    const sale = src("app/(owner)/owner/cost-batches/actions.ts");
    const body = sale.slice(sale.indexOf("export async function approveCostBatch("), sale.indexOf("export async function rejectCostBatch("));
    const safe = "This lot has already left stock and can no longer be sold.";
    const mapping = body.search(/res\.error\?\.code === "P0001" && \/already left stock\/\.test\(res\.error\.message\)/);
    expect(mapping, "the known refusal is mapped").toBeGreaterThan(-1);
    expect(body).toContain(`return fail("${safe}")`);
    expect(mapping, "before the raw database message could reach fromWrite").toBeLessThan(body.indexOf("fromWrite(res"));
    expect(safe, "no lot id").not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    // "can no longer be sold" is fine; asserting the lot WAS sold is not.
    expect(safe, "does not claim the lot was sold").not.toMatch(/sold elsewhere|was sold|been sold/i);
  });

  it("18. a lot on a live pass cannot be sold", async () => {
    const L = await lot();
    await issue(gm, L);
    const before = await outs("mixed_batch");
    const res = await approve(await runFor([L]));
    expect(res.error?.code).toBe("GP007");
    expect(await lotStatus(L)).toBe("available");
    expect(await outs("mixed_batch")).toBe(before);
  });

  it("19. a lot whose pass was cancelled can be sold", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await cancel(gm, data!.id as string);
    const res = await approve(await runFor([L]));
    expect(res.error, `sale: ${res.error?.message}`).toBeNull();
    expect(await lotStatus(L)).toBe("sold");
  });

  // ── Races with the sale path ──────────────────────────────────────────────
  it("20a. acknowledgement vs sale approval at the same instant: one deduction, no deadlock", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot();
      const { data } = await issue(gm, L);
      const runId = await runFor([L]);
      const mb = await outs("mixed_batch");
      const [a, s] = await Promise.all([ack(gate, data!.id as string), approve(runId)]);
      expect(a.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(s.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(a.error, `iteration ${i}: the release goes through`).toBeNull();
      // Which refusal the sale meets depends on commit order, and both are right:
      // it saw the live pass (GP007), or the release had already committed and
      // the lot was no longer available (the approval's own P0001 check).
      expect(s.error, `iteration ${i}: the sale is refused`).not.toBeNull();
      expect(["GP007", "P0001"], `iteration ${i}: refused by ${s.error?.code}`).toContain(s.error!.code);
      expect(await releasesFor(data!.id as string)).toHaveLength(1);
      expect(await outs("mixed_batch"), `iteration ${i}: no second deduction`).toBe(mb);
      expect(await lotStatus(L)).toBe("released");
    }
  }, 90_000);

  it("20b. issue vs sale approval at the same instant: exactly one wins", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const L = await lot();
      const runId = await runFor([L]);
      const [p, s] = await Promise.all([issue(gm, L), approve(runId)]);
      expect(p.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      expect(s.error?.code, `iteration ${i}`).not.toBe(DEADLOCK);
      const passWon = !p.error, saleWon = !s.error;
      expect(passWon !== saleWon, `iteration ${i}: exactly one of issue / sale wins`).toBe(true);
      if (passWon) {
        expect(s.error!.code).toBe("GP007");
        expect(await lotStatus(L)).toBe("available");
        expect(await livePasses(L)).toBe(1);
      } else {
        expect(p.error!.code).toBe("GP001");
        expect(await lotStatus(L)).toBe("sold");
        expect(await livePasses(L)).toBe(0);
      }
    }
  }, 90_000);

  it("20c. a two-bucket sale and a release sharing one bucket serialise without deadlock", async () => {
    for (let i = 0; i < REPEAT; i++) {
      const A = await lot(NS); const C = await lot(OS); const B = await lot(NS);
      const runId = await runFor([A, C]);
      const { data } = await issue(gm, B);
      const [s, a] = await Promise.all([approve(runId), ack(gate, data!.id as string)]);
      expect(s.error, `iteration ${i}: sale ${s.error?.code} ${s.error?.message}`).toBeNull();
      expect(a.error, `iteration ${i}: release ${a.error?.code} ${a.error?.message}`).toBeNull();
      expect([await lotStatus(A), await lotStatus(C), await lotStatus(B)]).toEqual(["sold", "sold", "released"]);
    }
  }, 90_000);

  // ── Everything that reads "available" ─────────────────────────────────────
  it("21. a released lot drops out of availability-derived views", async () => {
    const admin = adminClient();
    const mat2 = (await admin.from("material_types").insert({ name: `GPSI view ${stamp}` }).select("id").single()).data!.id as string;
    await admin.from("stock_movements").insert({
      site_id: NS, material_type_id: mat2, weight: 1000, direction: "in", reason: "purchase_intake", recorded_by: owner.userId,
    });
    const L = await lot(NS, 12, {}, mat2);
    const basis = async () => ((await admin.from("material_cost_basis").select("*").eq("material_type_id", mat2)).data ?? []).length;
    const pickable = async () => ((await gm.client.from("stock_lots").select("id").eq("status", "available").eq("id", L)).data ?? []).length;
    expect(await basis(), "counted while available").toBe(1);
    expect(await pickable()).toBe(1);

    const { data } = await issue(gm, L);
    expect((await ack(gate, data!.id as string)).error).toBeNull();

    expect(await basis(), "no longer valued as stock").toBe(0);
    expect(await pickable(), "no longer offered by any available-lot picker").toBe(0);
    const { data: sm } = await admin.from("stocked_materials").select("status").eq("id", L).single();
    expect(sm!.status).toBe("released");
  });

  it("22. record_stock_check refuses a released lot", async () => {
    const L = await lot();
    const { data } = await issue(gm, L);
    await ack(gate, data!.id as string);
    const { error } = await gm.client.rpc("record_stock_check", {
      p_lot_id: L, p_status: "confirmed", p_counted_weight: 10, p_note: undefined,
    } as never);
    expect(error, "a released lot is not in stock").not.toBeNull();
    const { count } = await adminClient().from("stock_confirmations").select("stock_lot_id", { count: "exact", head: true }).eq("stock_lot_id", L);
    expect(count).toBe(0);
  });

  // ── What must not change ──────────────────────────────────────────────────
  it("23. a free-text pass is unaffected: its own weight, and no stock movement", async () => {
    const { data, error } = await gm.client.from("gate_passes")
      .insert(passRow(gm, NS, null, { weight_kg: 77 })).select("id, weight_kg").single();
    expect(error, `free-text: ${error?.message}`).toBeNull();
    expect(Number(data!.weight_kg)).toBe(77);
    expect((await ack(gate, data!.id as string)).error).toBeNull();
    expect(await releasesFor(data!.id as string)).toHaveLength(0);
    expect((await adminClient().from("gate_passes").select("status").eq("id", data!.id).single()).data!.status).toBe("acknowledged");
  });

  it("24. unsettle_line still raises its pass exactly as before", async () => {
    const admin = adminClient();
    const { data: v } = await admin.from("visits").insert({
      site_id: NS, supplier_id: sup, declared_material_type_id: mat, entry_path: "processed",
      state: "in_receiving", created_by: gm.userId,
    }).select("id").single();
    const { data: line } = await admin.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: mat, weight_kg: 55, recorded_by: gm.userId,
    }).select("id").single();
    const { error } = await gm.client.rpc("unsettle_line", { p_line_id: line!.id, p_reason: "Off spec" } as never);
    expect(error, `unsettle_line: ${error?.message}`).toBeNull();
    const { data: gp } = await admin.from("gate_passes")
      .select("status, weight_kg, stock_lot_id, visit_material_id").eq("visit_material_id", line!.id).single();
    expect(gp!.status).toBe("issued");
    expect(Number(gp!.weight_kg)).toBe(55);
    expect(gp!.stock_lot_id).toBeNull();
  });

  it("25. a pass cannot be born acknowledged or cancelled; receiving still cannot issue", async () => {
    for (const status of ["acknowledged", "cancelled"]) {
      const { error } = await gm.client.from("gate_passes").insert(passRow(gm, NS, null, { status }));
      expect(error?.code, `born ${status}`).toBe("GP008");
    }
    const L = await lot(OS);
    const { error } = await recvOld.client.from("gate_passes").insert(passRow(recvOld, OS, L, { status: "issued" }));
    expect(error, "receiving cannot raise an issued pass").not.toBeNull();
  });

  it("26. historical gate releases with no pass link remain valid", async () => {
    const admin = adminClient();
    for (let i = 0; i < 2; i++) {
      const { error } = await admin.from("stock_movements").insert({
        site_id: NS, material_type_id: mat, weight: 1, direction: "out", reason: "gate_release", recorded_by: owner.userId,
      });
      expect(error, `unlinked release ${i}: ${error?.message}`).toBeNull();
    }
  });

  // ── The application speaks for the new refusals ───────────────────────────
  it("the actions translate 0155's refusals into operator sentences, never database text", () => {
    const issueBody = src("app/(manager)/manager/gate-passes/actions.ts");
    expect(issueBody).toContain('return fail("That stock lot already has a live gate pass.")');
    expect(issueBody).toMatch(/error\.code === "23505" && \(error\.details \?\? ""\)\.includes\("\(stock_lot_id\)"\)/);

    const ackBody = src("app/(gate)/gate/actions.ts");
    expect(ackBody).toContain('if (res.error?.code === "GP006") return fail("This lot is no longer available for release.")');
    expect(ackBody).toContain('return ok("This gate pass has already been acknowledged.")');

    const saleBody = src("app/(owner)/owner/cost-batches/actions.ts");
    expect(saleBody).toContain('if (res.error?.code === "GP007") return fail("Lot is on a live gate pass — cancel the pass first.")');

    const page = src("app/(manager)/manager/gate-passes/page.tsx");
    const lotQuery = page.slice(page.indexOf('from("stock_lots")'), page.indexOf(".limit(200)", page.indexOf('from("stock_lots")')));
    expect(lotQuery, "the picker leaves out lots already on a live pass").toMatch(/\.not\("id", "in"/);
    expect(page).toMatch(/\.in\("status", \["pending", "issued", "acknowledged"\]\)/);
  });
});
