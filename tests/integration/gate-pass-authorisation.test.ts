import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * A pending gate pass must be authorisable.
 *
 * When receiving unsettles a line, `unsettle_line` raises the gate pass as
 * PENDING for a manager to sign off — it carries no authority at the gate until
 * then. The database has always supported that: `authorize_gate_pass` moves
 * pending → issued for the owner, the general manager, or a manager on that
 * site, and pending → cancelled is legal too.
 *
 * There was simply no control for it. `authorizeGatePass` existed but had no
 * caller anywhere, and the gate-passes screen rendered its only button —
 * Cancel — behind `st === "issued"`. So a pending request could be neither
 * authorised nor dropped. Production had accumulated 14 of them, the oldest
 * from 2026-08-24, 10 raised by unsettled lines. The material behind them could
 * not legitimately leave the yard.
 */

const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

describe("gate pass authorisation", () => {
  let manager: TestUser, gate: TestUser;
  let siteId: string, materialTypeId: string;
  const stamp = Date.now();

  const pendingPass = async () => {
    const { data, error } = await adminClient().from("gate_passes").insert({
      site_id: siteId, material_type_id: materialTypeId,
      material_owner: `GP ${stamp}-${Math.random()}`,
      reason: "out of spec", status: "pending", issued_by: manager.userId,
    }).select("id").single();
    expect(error, `pass fixture: ${error?.message}`).toBeNull();
    return data!.id as string;
  };

  const statusOf = async (id: string) => {
    const { data } = await adminClient().from("gate_passes").select("status").eq("id", id).single();
    return data!.status as string;
  };

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    // The screen is general-manager gated, and the GM is the New-Site manager.
    siteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    const { data: mt } = await admin.from("material_types").select("id").eq("name", "Monazite").single();
    materialTypeId = mt!.id as string;
    manager = await makeUser({ username: `gp-mgr-${stamp}`, role: "manager", siteId });
    gate = await makeUser({ username: `gp-gate-${stamp}`, role: "gate", siteId });
  });

  it("a manager on that site can authorise a pending pass", async () => {
    const id = await pendingPass();
    const { error } = await manager.client.rpc("authorize_gate_pass", { p_pass_id: id } as never);
    expect(error, `authorise: ${error?.message}`).toBeNull();
    expect(await statusOf(id), "pending → issued").toBe("issued");
  });

  it("authorising a pass that is not pending is refused, with a reason", async () => {
    const id = await pendingPass();
    expect((await manager.client.rpc("authorize_gate_pass", { p_pass_id: id } as never)).error).toBeNull();
    // Second attempt: already issued.
    const { error } = await manager.client.rpc("authorize_gate_pass", { p_pass_id: id } as never);
    expect(error, "a second authorisation must be refused").not.toBeNull();
    expect(error!.message).toMatch(/only a pending gate pass/i);
    expect(await statusOf(id), "and must not change the pass").toBe("issued");
  });

  it("the gate cannot authorise — only acknowledge once issued", async () => {
    const id = await pendingPass();
    const { error } = await gate.client.rpc("authorize_gate_pass", { p_pass_id: id } as never);
    expect(error, "the gate must not be able to self-authorise").not.toBeNull();
    expect(await statusOf(id)).toBe("pending");
  });

  it("a pending pass can also be dropped, so a bad request is not stuck", async () => {
    const id = await pendingPass();
    const res = await manager.client.from("gate_passes")
      .update({ status: "cancelled" }).eq("id", id).select("id");
    expect(res.error, `cancel: ${res.error?.message}`).toBeNull();
    expect(res.data ?? [], "the update must actually affect the row").toHaveLength(1);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("the screen offers Authorise for a pending pass, and can drop one", () => {
    const page = src("app/(manager)/manager/gate-passes/page.tsx");
    expect(page, "authorizeGatePass must be wired in").toMatch(/action=\{authorizeGatePass\}/);
    expect(page, "Authorise must render for pending").toMatch(/st === "pending"/);
    expect(page, "cancel must cover pending as well as issued")
      .toMatch(/st === "issued" \|\| st === "pending"/);
  });

  it("both wired actions report failure instead of swallowing it", () => {
    // They are reachable now, so a silent version would be a new silent path.
    const actions = src("app/(manager)/manager/gate-passes/actions.ts");
    for (const fn of ["authorizeGatePass", "cancelGatePass"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
      expect(body, `${fn} must return ActionResult`).toContain("Promise<ActionResult>");
      expect(body.slice(0, 900), `${fn} must take the useActionState prev arg`)
        .toContain("_prev: ActionResult");
    }
    expect(actions, "the RPC error must be surfaced").toMatch(/if \(error\) return fail/);
    expect(actions, "the cancel must notice a zero-row update").toMatch(/data\.length === 0/);
  });
});
