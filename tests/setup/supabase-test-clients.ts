import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Cloud-safety guard: these tests wipe ALL auth users and must NEVER run against
// a cloud/production Supabase project. Fail fast if the URL is not local.
if (!URL.includes("127.0.0.1") && !URL.includes("localhost")) {
  throw new Error(
    `TEST SAFETY: NEXT_PUBLIC_SUPABASE_URL must point to 127.0.0.1 (local Supabase). Got: ${URL}. ` +
    `These tests wipe ALL auth users and must NEVER run against cloud.`,
  );
}

export type TestRole =
  | "processing" | "receiving" | "qc" | "manager" | "accounting" | "inventory"
  | "auditor" | "owner";

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Create a confirmed auth user + profile and return a client signed in as them.
export type TestUser = { client: SupabaseClient; id: string; userId: string };

export async function makeUser(opts: {
  username: string;
  role: TestRole;
  siteId: string | null;
}): Promise<TestUser> {
  const admin = adminClient();
  const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";
  const email = `${opts.username}@${domain}`;
  const password = "test-password-123";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  const { error: pErr } = await admin.from("profiles").insert({
    id,
    full_name: opts.username,
    username: opts.username,
    role: opts.role,
    site_id: opts.siteId,
    must_change_password: false,
  });
  if (pErr) throw pErr;

  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { client, id, userId: id };
}

export async function firstSiteId(): Promise<string> {
  const { data } = await adminClient().from("sites").select("id").limit(1).single();
  return data!.id as string;
}
