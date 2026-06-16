import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("transaction_events RLS", () => {
  let gate: TestUser, owner: TestUser;

  beforeAll(async () => {
    const siteId = await firstSiteId();
    gate = await makeUser({ username: "te-gate", role: "receiving", siteId });
    owner = await makeUser({ username: "te-owner", role: "owner", siteId: null });
  });

  it("non-owner cannot directly INSERT transaction_events", async () => {
    const { error } = await gate.client.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000000",
      event_type: "visit_created",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  it("owner cannot directly INSERT either (no INSERT policy)", async () => {
    const { error } = await owner.client.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000000",
      event_type: "visit_created",
      payload: {},
    });
    expect(error).not.toBeNull();
  });
});
