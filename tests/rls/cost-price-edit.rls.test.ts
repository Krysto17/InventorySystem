import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A computed cost price stays editable until the batch is sold: drop a lot,
// add/edit/remove an external material, rename it — and the weighted cost
// recomputes. An approved (sold) batch is locked.
describe("edit a computed cost price", () => {
  let newSite: string, monazite: string, supplierId: string;
  let gm: TestUser, siteMgr: TestUser, recv: TestUser, inv: TestUser, otherInv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    gm = await makeUser({ username: "cpx-gm", role: "manager", siteId: newSite });
    siteMgr = await makeUser({ username: "cpx-sm", role: "manager", siteId: sites!.find((s) => s.name !== "New-Site")!.id as string });
    inv = await makeUser({ username: "cpx-inv", role: "inventory", siteId: newSite });
    otherInv = await makeUser({ username: "cpx-inv2", role: "inventory", siteId: sites!.find((s) => s.name !== "New-Site")!.id as string });
    recv = await makeUser({ username: "cpx-recv", role: "receiving", siteId: newSite });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `CPX ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function lot(weight: number, cost: number) {
    const { data } = await adminClient().from("stock_lots")
      .insert({ site_id: newSite, material_type_id: monazite, supplier_id: supplierId, weight_kg: weight, cost_price_per_kg: cost, recorded_by: recv.userId })
      .select("id").single();
    return data!.id as string;
  }
  async function run(status: string | null = null) {
    const { data } = await adminClient().from("cost_price_runs")
      .insert({ site_id: newSite, label: `Run ${Date.now()}-${Math.random()}`, approval_status: status, created_by: gm.userId })
      .select("id").single();
    return data!.id as string;
  }
  const avg = async (id: string) => Number((await adminClient().from("cost_price_runs").select("avg_cost_price_per_kg").eq("id", id).single()).data!.avg_cost_price_per_kg);

  it("removing a lot recomputes the weighted cost", async () => {
    const rid = await run();
    const a = await lot(100, 10); // ₦1000
    const b = await lot(100, 30); // ₦3000
    await adminClient().from("cost_price_run_lots").insert([
      { run_id: rid, stock_lot_id: a }, { run_id: rid, stock_lot_id: b },
    ]);
    expect(await avg(rid)).toBe(20); // 4000/200

    const { error } = await gm.client.from("cost_price_run_lots").delete().eq("run_id", rid).eq("stock_lot_id", b);
    expect(error).toBeNull();
    expect(await avg(rid)).toBe(10); // 1000/100
  });

  it("editing an external material recomputes the weighted cost", async () => {
    const rid = await run();
    await adminClient().from("cost_price_run_lots").insert({ run_id: rid, stock_lot_id: await lot(100, 10) });
    const { data: ex } = await gm.client.from("cost_price_run_extras")
      .insert({ run_id: rid, material_name: "Bought tin", weight_kg: 100, cost_price_per_kg: 30 }).select("id").single();
    expect(await avg(rid)).toBe(20); // (1000+3000)/200

    // Correct the cost 30 → 50  ⇒ (1000+5000)/200 = 30
    const { error } = await gm.client.from("cost_price_run_extras")
      .update({ cost_price_per_kg: 50 }).eq("id", ex!.id);
    expect(error).toBeNull();
    expect(await avg(rid)).toBe(30);

    // Remove it ⇒ back to 10
    await gm.client.from("cost_price_run_extras").delete().eq("id", ex!.id);
    expect(await avg(rid)).toBe(10);
  });

  it("the GM can rename an unapproved computation", async () => {
    const rid = await run();
    const { error } = await gm.client.from("cost_price_runs").update({ label: "Renamed mix" }).eq("id", rid);
    expect(error).toBeNull();
    expect((await adminClient().from("cost_price_runs").select("label").eq("id", rid).single()).data!.label).toBe("Renamed mix");
  });

  it("an APPROVED (sold) batch is locked", async () => {
    const rid = await run("approved");
    const l = await lot(50, 20);
    await adminClient().from("cost_price_run_lots").insert({ run_id: rid, stock_lot_id: l });

    // rename blocked
    await gm.client.from("cost_price_runs").update({ label: "nope" }).eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("label").eq("id", rid).single()).data!.label).not.toBe("nope");
    // lot removal blocked
    await gm.client.from("cost_price_run_lots").delete().eq("run_id", rid).eq("stock_lot_id", l);
    expect((await adminClient().from("cost_price_run_lots").select("stock_lot_id").eq("run_id", rid)).data!.length).toBe(1);
  });

  it("a site manager cannot edit a computation", async () => {
    const rid = await run();
    await siteMgr.client.from("cost_price_runs").update({ label: "hijack" }).eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("label").eq("id", rid).single()).data!.label).not.toBe("hijack");
  });

  // 0149: the inventory employee runs the module on their own site.
  it("inventory edits and deletes an unapproved computation on its own site", async () => {
    const rid = await run();
    const a = await lot(100, 10);
    const b = await lot(100, 30);
    await adminClient().from("cost_price_run_lots").insert([
      { run_id: rid, stock_lot_id: a }, { run_id: rid, stock_lot_id: b },
    ]);

    expect((await inv.client.from("cost_price_runs").update({ label: "Inventory mix" }).eq("id", rid)).error).toBeNull();
    expect((await adminClient().from("cost_price_runs").select("label").eq("id", rid).single()).data!.label).toBe("Inventory mix");

    expect((await inv.client.from("cost_price_run_lots").delete().eq("run_id", rid).eq("stock_lot_id", b)).error).toBeNull();
    expect(await avg(rid)).toBe(10);

    const { data: ex } = await inv.client.from("cost_price_run_extras")
      .insert({ run_id: rid, material_name: "Bought tin", weight_kg: 100, cost_price_per_kg: 30 }).select("id").single();
    expect(await avg(rid)).toBe(20);
    await inv.client.from("cost_price_run_extras").delete().eq("id", ex!.id);
    expect(await avg(rid)).toBe(10);

    await inv.client.from("cost_price_runs").delete().eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("id").eq("id", rid).maybeSingle()).data).toBeNull();
  });

  it("an inventory user at another site sees nothing and cannot edit", async () => {
    const rid = await run();
    expect((await otherInv.client.from("cost_price_runs").select("id").eq("id", rid)).data ?? []).toHaveLength(0);
    await otherInv.client.from("cost_price_runs").update({ label: "hijack" }).eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("label").eq("id", rid).single()).data!.label).not.toBe("hijack");
    await otherInv.client.from("cost_price_runs").delete().eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("id").eq("id", rid).maybeSingle()).data).not.toBeNull();
  });

  it("inventory cannot touch an APPROVED (sold) batch", async () => {
    const rid = await run("approved");
    await inv.client.from("cost_price_runs").update({ label: "nope" }).eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("label").eq("id", rid).single()).data!.label).not.toBe("nope");
    await inv.client.from("cost_price_runs").delete().eq("id", rid);
    expect((await adminClient().from("cost_price_runs").select("id").eq("id", rid).maybeSingle()).data).not.toBeNull();
  });
});
