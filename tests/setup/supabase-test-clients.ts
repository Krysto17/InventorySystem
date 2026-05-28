import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Create a confirmed auth user + profile and return a client signed in as them.
export async function makeUser(opts: {
  username: string;
  role: string;
  siteId: string | null;
}): Promise<{ client: SupabaseClient; id: string }> {
  const admin = adminClient();
  const email = `${opts.username}@magneticjoezion.local`;
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
  return { client, id };
}

export async function firstSiteId(): Promise<string> {
  const { data } = await adminClient().from("sites").select("id").limit(1).single();
  return data!.id as string;
}
