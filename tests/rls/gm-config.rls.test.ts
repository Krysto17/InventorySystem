import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The general manager (New-Site) may manage technical config (material types +
// machines); a site manager may not.
describe("general manager manages config", () => {
  let siteId: string, newSite: string;
  let gm: TestUser, siteMgr: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    gm = await makeUser({ username: "cfg-gm", role: "manager", siteId: newSite });
    siteMgr = await makeUser({ username: "cfg-sm", role: "manager", siteId });
  });

  it("GM creates a material type; site manager cannot", async () => {
    expect((await gm.client.from("material_types").insert({ name: `GM Mat ${Date.now()}` }).select("id")).error).toBeNull();
    const r = await siteMgr.client.from("material_types").insert({ name: `SM Mat ${Date.now()}` }).select("id");
    expect(r.error ?? (r.data?.length ?? 0) === 0 ? true : null).toBeTruthy();
  });

  it("GM creates a machine; site manager cannot", async () => {
    expect((await gm.client.from("machines").insert({ name: `GM Machine ${Date.now()}`, site_id: newSite, charge_basis: "weight", rate: 5 }).select("id")).error).toBeNull();
    const r = await siteMgr.client.from("machines").insert({ name: `SM Machine ${Date.now()}`, site_id: siteId, charge_basis: "weight", rate: 5 }).select("id");
    expect(r.error ?? (r.data?.length ?? 0) === 0 ? true : null).toBeTruthy();
  });
});
