import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 11 (D): private 'receipts' bucket. Upload: accounting/owner. Read:
// accounting/manager/owner. Everyone else is locked out by Storage RLS.
describe("receipts bucket Storage RLS", () => {
  let siteId: string;
  let acct: TestUser, mgr: TestUser, recv: TestUser, owner: TestUser;

  const fileBody = () => new Blob(["fake receipt body"], { type: "text/plain" });

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    acct  = await makeUser({ username: "rcpt-acct", role: "accounting", siteId });
    mgr   = await makeUser({ username: "rcpt-mgr",  role: "manager",    siteId });
    recv  = await makeUser({ username: "rcpt-recv", role: "receiving",  siteId });
    owner = await makeUser({ username: "rcpt-owner", role: "owner",     siteId: null });
  });

  it("the private receipts bucket exists", async () => {
    const { data, error } = await adminClient().storage.getBucket("receipts");
    expect(error).toBeNull();
    expect(data!.public).toBe(false);
  });

  it("accountant can upload a receipt", async () => {
    const { error } = await acct.client.storage
      .from("receipts")
      .upload(`test/acct-${Date.now()}.txt`, fileBody());
    expect(error).toBeNull();
  });

  it("receiving cannot upload a receipt", async () => {
    const { error } = await recv.client.storage
      .from("receipts")
      .upload(`test/recv-${Date.now()}.txt`, fileBody());
    expect(error).not.toBeNull();
  });

  it("manager and owner can download; receiving cannot", async () => {
    const path = `test/dl-${Date.now()}.txt`;
    const up = await acct.client.storage.from("receipts").upload(path, fileBody());
    expect(up.error).toBeNull();

    const mgrDl = await mgr.client.storage.from("receipts").download(path);
    expect(mgrDl.error).toBeNull();
    const ownDl = await owner.client.storage.from("receipts").download(path);
    expect(ownDl.error).toBeNull();

    const recvDl = await recv.client.storage.from("receipts").download(path);
    expect(recvDl.error).not.toBeNull();
  });
});
