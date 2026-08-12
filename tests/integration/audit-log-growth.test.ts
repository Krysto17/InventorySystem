import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The audit log has to keep every real edit and stop keeping the echoes: a
// no-op write, or the parent-row touch that only exists to recompute a total.
describe("the audit log records changes, not echoes", () => {
  let siteId: string, supplierId: string, material: string;
  let recv: TestUser, mgr: TestUser, owner: TestUser;

  const eventsFor = async (visitId: string, table: string) => {
    const { data } = await adminClient().from("transaction_events")
      .select("event_type, payload").eq("visit_id", visitId).eq("event_type", "record_edited");
    return (data ?? []).filter((e) => (e.payload as { table?: string })?.table === table);
  };

  const newVisit = async () => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }).select("id").single();
    return data!.id as string;
  };

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    recv = await makeUser({ username: "al-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "al-mgr", role: "manager", siteId });
    owner = await makeUser({ username: "al-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `AL ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Audit-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
  });

  it("records a real edit, with what changed", async () => {
    const v = await newVisit();
    const { data: line } = await adminClient().from("visit_materials")
      .insert({ visit_id: v, material_type_id: material, weight_kg: 100 }).select("id").single();

    await adminClient().from("visit_materials").update({ weight_kg: 120 }).eq("id", line!.id);

    const events = await eventsFor(v, "visit_materials");
    expect(events).toHaveLength(1);
    const diff = (events[0].payload as { diff: Record<string, { old: unknown; new: unknown }> }).diff;
    expect(diff.weight_kg).toBeTruthy();
    expect(Number(diff.weight_kg.new)).toBe(120);
  });

  it("writes nothing when the update changes nothing", async () => {
    const v = await newVisit();
    const { data: line } = await adminClient().from("visit_materials")
      .insert({ visit_id: v, material_type_id: material, weight_kg: 50 }).select("id").single();

    // Same value back in: only updated_at moves, which is not a business change.
    await adminClient().from("visit_materials").update({ weight_kg: 50 }).eq("id", line!.id);
    expect(await eventsFor(v, "visit_materials")).toHaveLength(0);
  });

  it("does not log the pricing row that a line edit only touches to recompute", async () => {
    const v = await newVisit();
    await adminClient().from("pricing")
      .insert({ visit_id: v, agreement_status: "pending", priced_by: mgr.userId });
    const { data: line } = await adminClient().from("visit_materials")
      .insert({ visit_id: v, material_type_id: material, weight_kg: 10 }).select("id").single();

    const before = (await eventsFor(v, "pricing")).length;
    await adminClient().from("visit_materials").update({ weight_kg: 11 }).eq("id", line!.id);
    // The line edit is recorded; the pricing echo behind it is not.
    expect(await eventsFor(v, "visit_materials")).toHaveLength(1);
    expect(await eventsFor(v, "pricing")).toHaveLength(before);
  });

  it("still records a genuine pricing change", async () => {
    const v = await newVisit();
    await adminClient().from("pricing")
      .insert({ visit_id: v, agreement_status: "pending", priced_by: mgr.userId });
    await adminClient().from("pricing").update({ payment_terms: "deferred" }).eq("visit_id", v);
    expect(await eventsFor(v, "pricing")).toHaveLength(1);
  });

  it("pruning is the owner's alone, and spares the workflow story", async () => {
    const v = await newVisit();
    const { data: line } = await adminClient().from("visit_materials")
      .insert({ visit_id: v, material_type_id: material, weight_kg: 5 }).select("id").single();
    await adminClient().from("visit_materials").update({ weight_kg: 6 }).eq("id", line!.id);
    await adminClient().from("visits").update({ state: "stocked" }).eq("id", v);
    // Age the rows past the cutoff.
    await adminClient().from("transaction_events")
      .update({ created_at: "2020-01-01T00:00:00Z" }).eq("visit_id", v);

    expect((await mgr.client.rpc("prune_transaction_events", { p_older_than: "1 day" })).error).not.toBeNull();

    const { error } = await owner.client.rpc("prune_transaction_events", { p_older_than: "1 day" });
    expect(error).toBeNull();

    expect(await eventsFor(v, "visit_materials")).toHaveLength(0); // edits pruned
    const { data: kept } = await adminClient().from("transaction_events")
      .select("event_type").eq("visit_id", v);
    expect(kept!.length).toBeGreaterThan(0);
    expect(kept!.every((e) => e.event_type !== "record_edited")).toBe(true);
  });
});
