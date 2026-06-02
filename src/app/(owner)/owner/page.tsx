import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTimestamp } from "@/lib/visits/format";

export default async function OwnerHomePage() {
  const supabase = await createClient();
  const { data: awaiting } = await supabase
    .from("visits")
    .select(`id, created_at, state, vehicle_plate,
             site:sites(name),
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .eq("state", "awaiting_gate_exit")
    .order("created_at", { ascending: true });

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Owner — cross-site overview</h1>
      </header>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link href="/owner/employees" className="px-3 py-2 border rounded">Employees</Link>
        <Link href="/owner/material-types" className="px-3 py-2 border rounded">Material types</Link>
        <Link href="/owner/machines" className="px-3 py-2 border rounded">Machines</Link>
        <Link href="/owner/visits" className="px-3 py-2 border rounded">All visits</Link>
      </nav>

      <section>
        <h2 className="font-semibold mb-2">
          Awaiting your sign-off ({awaiting?.length ?? 0})
        </h2>
        {!awaiting || awaiting.length === 0 ? (
          <p className="text-sm text-gray-600">No visits awaiting authorization.</p>
        ) : (
          <ul className="border rounded divide-y">
            {awaiting.map((v) => {
              const sup = v.supplier as unknown as { name?: string; phone?: string | null } | null;
              const mat = v.declared_material_type as unknown as { name?: string } | null;
              const site = v.site as unknown as { name?: string } | null;
              return (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-medium">{sup?.name ?? "—"}</div>
                        <div className="text-sm text-gray-600">
                          {site?.name ?? "—"} · {mat?.name ?? "—"} ·{" "}
                          {v.vehicle_plate ?? "no plate"}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatTimestamp(v.created_at)}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
