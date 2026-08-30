import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { storageAvailable } from "../setup/app-server";

// Probed at collection time. Without Storage running, an upload fails on the
// network and the "cannot upload" cases would pass whether or not the RLS they
// exist to prove is still in place — so the file is skipped rather than
// half-run. Start it with: npx supabase start (without -x storage-api).
const storageUp = await storageAvailable();
const itStorage = storageUp ? it : it.skip;

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

  itStorage("the private receipts bucket exists", async () => {
    const { data, error } = await adminClient().storage.getBucket("receipts");
    expect(error).toBeNull();
    expect(data!.public).toBe(false);
  });

  itStorage("accountant can upload a receipt", async () => {
    const { error } = await acct.client.storage
      .from("receipts")
      .upload(`test/acct-${Date.now()}.txt`, fileBody());
    expect(error).toBeNull();
  });

  itStorage("receiving cannot upload a receipt", async () => {
    const { error } = await recv.client.storage
      .from("receipts")
      .upload(`test/recv-${Date.now()}.txt`, fileBody());
    expect(error).not.toBeNull();
  });

  itStorage("manager and owner can download; receiving cannot", async () => {
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
