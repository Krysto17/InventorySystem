import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { STATE_LABELS, VISIT_STATES, type VisitState } from "@/lib/visits/state-machine";
import { formatTimestamp } from "@/lib/visits/format";

type SP = { state?: string; site_id?: string };

export default async function OwnerVisitsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");

  let q = supabase
    .from("visits")
    .select(`id, created_at, state,
             site:sites(name),
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (sp.state) q = q.eq("state", sp.state);
  if (sp.site_id) q = q.eq("site_id", sp.site_id);
  const { data: rows } = await q;

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">All visits</h1>

      <form className="flex gap-2 text-sm">
        <select
          name="state"
          defaultValue={sp.state ?? ""}
          className="border rounded px-2 py-1"
        >
          <option value="">All states</option>
          {VISIT_STATES.map((s) => (
            <option key={s} value={s}>{STATE_LABELS[s as VisitState]}</option>
          ))}
        </select>
        <select
          name="site_id"
          defaultValue={sp.site_id ?? ""}
          className="border rounded px-2 py-1"
        >
          <option value="">All sites</option>
          {(sites ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="submit" className="px-3 py-1 border rounded">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto"><table className="w-full border rounded text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 text-left">Site</th>
            <th className="p-2 text-left">Supplier</th>
            <th className="p-2 text-left">Material</th>
            <th className="p-2 text-left">State</th>
            <th className="p-2 text-left">Opened</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((v) => {
            const site = v.site as unknown as { name?: string } | null;
            const sup = v.supplier as unknown as { name?: string } | null;
            const mat = v.declared_material_type as unknown as { name?: string } | null;
            return (
              <tr key={v.id} className="border-t">
                <td className="p-2">{site?.name ?? "—"}</td>
                <td className="p-2">
                  <Link href={`/visits/${v.id}`} className="underline">
                    {sup?.name ?? "—"}
                  </Link>
                </td>
                <td className="p-2">{mat?.name ?? "—"}</td>
                <td className="p-2">{STATE_LABELS[v.state as VisitState]}</td>
                <td className="p-2">{formatTimestamp(v.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </main>
  );
}
