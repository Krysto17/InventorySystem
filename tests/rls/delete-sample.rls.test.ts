import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// QC deletes its own UNPRICED sample; a priced sample is protected (RLS).
describe("delete sample analysis", () => {
  let siteId: string, supplierId: string, monazite: string;
  let qc: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    qc = await makeUser({ username: "dsmp-qc", role: "qc", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `DSMP ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function sample(price: number | null) {
    const { data } = await adminClient().from("sample_analyses").insert({
      supplier_name: "Sample Supplier", site_id: siteId, material_type_id: monazite,
      result: "OK", recorded_by: qc.userId, price,
    }).select("id").single();
    return data!.id as string;
  }

  it("deletes an own unpriced sample", async () => {
    const id = await sample(null);
    const { error } = await qc.client.from("sample_analyses").delete().eq("id", id);
    expect(error).toBeNull();
    const { data } = await adminClient().from("sample_analyses").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot delete a priced sample", async () => {
    const id = await sample(5000);
    await qc.client.from("sample_analyses").delete().eq("id", id);
    const { data } = await adminClient().from("sample_analyses").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(1); // protected
  });
});
