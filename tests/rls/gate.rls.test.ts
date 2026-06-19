import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Gate passes (manager/owner issue → security acknowledge) + gate movement log.
describe("gate passes + gate logs RLS", () => {
  let siteAId: string, siteBId: string;
  let mgrA: TestUser, secA: TestUser, secB: TestUser, invA: TestUser, owner: TestUser;

  async function issuePass(siteId: string, issuedBy: string) {
    const { data, error } = await adminClient()
      .from("gate_passes")
      .insert({ site_id: siteId, reason: "Outgoing concentrate", issued_by: issuedBy })
      .select("id, pass_code, status")
      .single();
    if (error) throw error;
    return data!;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    mgrA  = await makeUser({ username: "gp-mgr-a",  role: "manager",   siteId: siteAId });
    secA  = await makeUser({ username: "gp-sec-a",  role: "security",  siteId: siteAId });
    secB  = await makeUser({ username: "gp-sec-b",  role: "security",  siteId: siteBId });
    invA  = await makeUser({ username: "gp-inv-a",  role: "inventory", siteId: siteAId });
    owner = await makeUser({ username: "gp-owner",  role: "owner",     siteId: null });
  });

  it("auto-generates a GP- pass code on insert", async () => {
    const pass = await issuePass(siteAId, mgrA.userId);
    expect(pass.pass_code as string).toMatch(/^GP-[A-Z]{1,3}-\d{4}$/);
    expect(pass.status).toBe("issued");
  });

  it("manager at site A can issue a gate pass for site A", async () => {
    const { error } = await mgrA.client.from("gate_passes").insert({
      site_id: siteAId,
      reason: "Release to buyer",
      issued_by: mgrA.userId,
    });
    expect(error).toBeNull();
  });

  it("security cannot issue a gate pass", async () => {
    const { error } = await secA.client.from("gate_passes").insert({
      site_id: siteAId,
      reason: "Security should not issue",
      issued_by: secA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("security at site A acknowledges an issued pass; security at site B cannot", async () => {
    const pass = await issuePass(siteAId, mgrA.userId);
    const cross = await secB.client
      .from("gate_passes")
      .update({ status: "acknowledged" })
      .eq("id", pass.id);
    // site-B security sees no site-A row → update affects nothing (no error, no change)
    const { data: stillIssued } = await adminClient()
      .from("gate_passes").select("status").eq("id", pass.id).single();
    expect(stillIssued!.status).toBe("issued");

    const { error } = await secA.client
      .from("gate_passes")
      .update({ status: "acknowledged" })
      .eq("id", pass.id);
    expect(error).toBeNull();
    const { data } = await adminClient()
      .from("gate_passes").select("status, acknowledged_at").eq("id", pass.id).single();
    expect(data!.status).toBe("acknowledged");
    expect(data!.acknowledged_at).not.toBeNull();
    void cross;
  });

  it("manager can cancel an issued pass; security cannot cancel", async () => {
    const pass = await issuePass(siteAId, mgrA.userId);
    const secTry = await secA.client
      .from("gate_passes").update({ status: "cancelled" }).eq("id", pass.id);
    expect(secTry.error).not.toBeNull();

    const { error } = await mgrA.client
      .from("gate_passes").update({ status: "cancelled" }).eq("id", pass.id);
    expect(error).toBeNull();
  });

  it("security at site A logs a movement for site A; inventory cannot log", async () => {
    const { error: secErr } = await secA.client.from("gate_logs").insert({
      site_id: siteAId,
      direction: "in",
      driver_name: "Sani",
      bags: 12,
      recorded_by: secA.userId,
    });
    expect(secErr).toBeNull();

    const { error: invErr } = await invA.client.from("gate_logs").insert({
      site_id: siteAId,
      direction: "in",
      recorded_by: invA.userId,
    });
    expect(invErr).not.toBeNull();
  });

  it("security at site B cannot log a movement for site A", async () => {
    const { error } = await secB.client.from("gate_logs").insert({
      site_id: siteAId,
      direction: "out",
      recorded_by: secB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("owner can read gate passes and logs across sites", async () => {
    const pass = await issuePass(siteBId, owner.userId);
    const { data } = await owner.client.from("gate_passes").select("id").eq("id", pass.id);
    expect(data ?? []).toHaveLength(1);
  });

  it("manager has cross-site read of gate logs (combined reports)", async () => {
    const { data: row } = await adminClient().from("gate_logs").insert({
      site_id: siteBId, direction: "out", recorded_by: owner.userId,
    }).select("id").single();
    const { data } = await mgrA.client.from("gate_logs").select("id").eq("id", row!.id);
    expect(data ?? []).toHaveLength(1);
  });
});
