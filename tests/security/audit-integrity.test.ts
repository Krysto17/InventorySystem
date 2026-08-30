import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The audit trail is only worth keeping if the people it records cannot edit it.
describe("audit trail integrity", () => {
  let siteId: string, supplierId: string, material: string;
  let low: TestUser, mgr: TestUser, owner: TestUser;
  const tag = String(Date.now()).slice(-9);

  const total = async () =>
    (await adminClient().from("transaction_events").select("id", { count: "exact", head: true })).count!;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    low = await makeUser({ username: `aud-low-${tag}`, role: "receiving", siteId });
    mgr = await makeUser({ username: `aud-mgr-${tag}`, role: "manager", siteId });
    owner = await makeUser({ username: `aud-own-${tag}`, role: "owner", siteId: null });
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `Aud ${tag}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Aud-Ore ${tag}` }).select("id").single();
    material = mt!.id as string;
  });

  const newVisit = async (state = "in_qc") => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state, created_by: low.userId,
    }).select("id").single();
    return data!.id as string;
  };

  it("a user who can SEE an audit record still cannot change it", async () => {
    const v = await newVisit();
    const visible = (await low.client.from("transaction_events").select("id, payload").eq("visit_id", v)).data ?? [];
    expect(visible.length, "fixture: the user must be able to see it for this test to mean anything")
      .toBeGreaterThan(0);

    const target = visible[0].id as string;
    const before = JSON.stringify(visible[0].payload);
    await low.client.from("transaction_events").update({ payload: { tampered: true } }).eq("id", target);
    const after = (await adminClient().from("transaction_events").select("payload").eq("id", target).single()).data!;
    expect(JSON.stringify(after.payload)).toBe(before);
  });

  it("cannot delete audit records", async () => {
    const v = await newVisit();
    const before = await total();
    await low.client.from("transaction_events").delete().eq("visit_id", v);
    expect(await total()).toBe(before);
  });

  it("cannot forge a privileged audit event", async () => {
    const res = await low.client.from("transaction_events").insert({
      event_type: "owner_override", payload: { forged: true },
    } as never);
    expect(res.error).not.toBeNull();
  });

  it("not even the manager or the owner may rewrite history", async () => {
    const v = await newVisit();
    const row = (await adminClient().from("transaction_events").select("id, payload").eq("visit_id", v).limit(1).single()).data!;
    const before = JSON.stringify(row.payload);
    await mgr.client.from("transaction_events").update({ payload: { tampered: true } }).eq("id", row.id);
    await owner.client.from("transaction_events").update({ payload: { tampered: true } }).eq("id", row.id);
    const after = (await adminClient().from("transaction_events").select("payload").eq("id", row.id).single()).data!;
    expect(JSON.stringify(after.payload)).toBe(before);
  });

  it("deleting the batch does not destroy its history", async () => {
    const v = await newVisit();
    await adminClient().from("visit_materials")
      .insert({ visit_id: v, material_type_id: material, weight_kg: 12 });
    const before = (await adminClient().from("transaction_events").select("id").eq("visit_id", v)).data!.length;
    expect(before).toBeGreaterThan(0);

    expect((await low.client.rpc("delete_batch", { p_visit_id: v })).error).toBeNull();
    expect((await adminClient().from("visits").select("id").eq("id", v)).data ?? []).toHaveLength(0);

    // The events survive with visit_id nulled — 0143 changed the key from
    // CASCADE to SET NULL precisely so deleting a batch cannot erase the record.
    const orphans = (await owner.client.from("audit_trail")
      .select("id, entity").is("visit_id", null).eq("entity", "visit_materials")).data ?? [];
    expect(orphans.length).toBeGreaterThan(0);
  });

  it("privileged work still produces events", async () => {
    const before = (await adminClient().from("transaction_events")
      .select("id").eq("entity", "consumables")).data!.length;
    await adminClient().from("consumables").insert({
      site_id: siteId, name: `Aud expense ${tag}`, category: "others", amount_naira: 250,
    });
    const after = (await adminClient().from("transaction_events")
      .select("id").eq("entity", "consumables")).data!.length;
    expect(after).toBeGreaterThan(before);
  });
});
