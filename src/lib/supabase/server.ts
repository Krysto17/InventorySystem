import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch (e) {
            // Server Components cannot mutate cookies — middleware refreshes the
            // session instead. Re-throw anything that isn't that read-only error
            // so unexpected failures aren't silently swallowed.
            if (!(e instanceof Error) || !/cookies/i.test(e.message)) throw e;
          }
        },
      },
    },
  );
}
