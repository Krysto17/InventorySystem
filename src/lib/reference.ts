import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export type Ref = { id: string; name: string };

export const SITES_TAG = "ref:sites";
export const MATERIALS_TAG = "ref:material-types";

/**
 * Sites and material types — the lookup tables behind every picker.
 *
 * They change a handful of times a year but were re-read on every render of
 * every page that draws a dropdown, so they are cached across requests and
 * dropped by tag when an admin edits them.
 *
 * These two reads use the service-role client because unstable_cache runs
 * outside the request and has no cookies to build a user-scoped client from.
 * That is safe HERE and nowhere else: both tables are plain lookup lists that
 * every authenticated role can already read in full (sites is `using (true)`),
 * they hold no per-user, per-site or money data, and the cached value is
 * therefore identical for every viewer. Any table whose rows differ by who is
 * asking must keep going through the user's own client.
 */
export const getSites = unstable_cache(
  async (): Promise<Ref[]> => {
    const { data } = await createAdminClient().from("sites").select("id, name").order("name");
    return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
  },
  ["ref-sites"],
  { tags: [SITES_TAG], revalidate: 3600 },
);

export const getActiveMaterialTypes = unstable_cache(
  async (): Promise<Ref[]> => {
    const { data } = await createAdminClient()
      .from("material_types").select("id, name").eq("active", true).order("name");
    return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
  },
  ["ref-material-types"],
  { tags: [MATERIALS_TAG], revalidate: 3600 },
);

/** Called by the admin actions that add, rename or deactivate these records. */
export function revalidateReference(what: "sites" | "materials") {
  // Next 16 takes the cache-life profile to expire alongside the tag.
  revalidateTag(what === "sites" ? SITES_TAG : MATERIALS_TAG, "max");
}
