import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("state-machine invariants", () => {
  let siteId: string, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    owner = await makeUser({ username: "inv-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "INV Supp", phone: "07055550001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  const visit = async (state: string) => {
    const { data } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    return data!.id as string;
  };

  it("a direct write cannot enter pricing — only the stage's own workflow can (0159)", async () => {
    const id = await visit("in_receiving");
    const { error } = await owner.client.from("visits").update({ state: "pricing" }).eq("id", id);
    expect(error?.code).toBe("VT001");
    const { data } = await adminClient().from("visits").select("state").eq("id", id).single();
    expect(data!.state).toBe("in_receiving");
  });

  it("the owner can no longer override pricing → exited without the dressing-only workflow", async () => {
    const id = await visit("pricing");
    const direct = await owner.client.from("visits").update({ state: "exited" }).eq("id", id);
    expect(direct.error?.code).toBe("VT001");

    // The owner's legitimate way out of pricing for a dressing-only customer.
    await adminClient().from("utility_charges").insert({
      visit_id: id, kind: "light_bill", description: "Processing fee", amount: 500,
    });
    const { error } = await owner.client.rpc("close_dressing_only", { p_visit_id: id, p_carry: true });
    expect(error).toBeNull();
    const { data: final } = await adminClient().from("visits").select("state, closed_at").eq("id", id).single();
    expect(final?.state).toBe("exited");
    expect(final?.closed_at).not.toBeNull();
  });
});
