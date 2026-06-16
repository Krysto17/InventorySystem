import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("suppliers RLS", () => {
  let siteAId: string, siteBId: string;
  let gateA: TestUser, gateB: TestUser, owner: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    gateA = await makeUser({ username: "sup-gate-a", role: "receiving", siteId: siteAId });
    gateB = await makeUser({ username: "sup-gate-b", role: "receiving", siteId: siteBId });
    owner = await makeUser({ username: "sup-owner", role: "owner", siteId: null });
  });

  it("any role can insert a supplier", async () => {
    const { data, error } = await gateA.client
      .from("suppliers")
      .insert({ name: "Musa Abubakar", phone: "07012345678" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("suppliers are visible across sites (global)", async () => {
    await gateA.client
      .from("suppliers")
      .insert({ name: "Cross Site Supplier", phone: "07099999999" });
    const { data, error } = await gateB.client
      .from("suppliers")
      .select("id, name")
      .eq("phone", "07099999999");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("non-owner cannot update a supplier", async () => {
    const { data: row } = await adminClient()
      .from("suppliers")
      .insert({ name: "Editable", phone: "07088000000" })
      .select("id")
      .single();
    await gateA.client.from("suppliers").update({ name: "Changed" }).eq("id", row!.id);
    const { data: after } = await adminClient()
      .from("suppliers")
      .select("name")
      .eq("id", row!.id)
      .single();
    expect(after?.name).toBe("Editable");
  });

  it("owner can update a supplier", async () => {
    const { data: row } = await adminClient()
      .from("suppliers")
      .insert({ name: "Owner-editable", phone: "07077000000" })
      .select("id")
      .single();
    const { error } = await owner.client
      .from("suppliers")
      .update({ name: "Updated" })
      .eq("id", row!.id);
    expect(error).toBeNull();
  });
});
