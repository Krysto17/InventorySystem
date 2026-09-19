import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approveCostRunAs } from "../setup/approvals";

// The general manager (or owner) can delete an unapproved cost-price run; an
// approved (sold) one is locked; a site manager can't delete at all.
describe("delete cost-price run", () => {
  let siteId: string, newSite: string;
  let gm: TestUser, siteMgr: TestUser, owner: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    gm = await makeUser({ username: "cpd-gm", role: "manager", siteId: newSite });
    siteMgr = await makeUser({ username: "cpd-sm", role: "manager", siteId });
    owner = await makeUser({ username: "cpd-owner", role: "owner", siteId: null });
  });

  const run = (status: string | null) => adminClient().from("cost_price_runs")
    .insert({ site_id: newSite, label: `Run ${Date.now()}-${Math.random()}`, approval_status: status, created_by: gm.userId })
    .select("id").single();
  const exists = async (id: string) =>
    (await adminClient().from("cost_price_runs").select("id").eq("id", id).maybeSingle()).data != null;

  it("GM deletes a computation (null status)", async () => {
    const { data } = await run(null);
    expect((await gm.client.from("cost_price_runs").delete().eq("id", data!.id)).error).toBeNull();
    expect(await exists(data!.id)).toBe(false);
  });

  it("GM deletes a pending batch", async () => {
    const { data } = await run("pending");
    await gm.client.from("cost_price_runs").delete().eq("id", data!.id);
    expect(await exists(data!.id)).toBe(false);
  });

  it("an approved (sold) batch cannot be deleted", async () => {
    // 0160: nothing is born approved — the owner approves a pending batch, which
    // sells its lot, so the lot needs stock behind it.
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    await adminClient().from("stock_movements").insert({
      site_id: newSite, material_type_id: mz!.id, weight: 25, direction: "in", recorded_by: owner.userId, reason: "purchase_intake",
    });
    const { data: lotRow } = await adminClient().from("stock_lots").insert({
      site_id: newSite, material_type_id: mz!.id, weight_kg: 25, cost_price_per_kg: 10, recorded_by: owner.userId,
    }).select("id").single();
    const { data } = await run("pending");
    expect((await adminClient().from("cost_price_run_lots").insert({ run_id: data!.id, stock_lot_id: lotRow!.id })).error).toBeNull();
    expect((await approveCostRunAs(owner.client, data!.id as string)).error).toBeNull();
    await gm.client.from("cost_price_runs").delete().eq("id", data!.id);
    expect(await exists(data!.id)).toBe(true);
    // owner can't delete it either
    await owner.client.from("cost_price_runs").delete().eq("id", data!.id);
    expect(await exists(data!.id)).toBe(true);
  });

  it("a site manager cannot delete a computation", async () => {
    const { data } = await run(null);
    await siteMgr.client.from("cost_price_runs").delete().eq("id", data!.id);
    expect(await exists(data!.id)).toBe(true);
  });
});
