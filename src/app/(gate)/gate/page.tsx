import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";
import { getProfile } from "@/lib/auth/get-profile";

export default async function GateHomePage() {
  const me = await getProfile();
  const supabase = await createClient();

  const awaiting = await listVisitsByState(["awaiting_gate_exit"]);

  const { data: recent } = await supabase
    .from("visits")
    .select(`id, created_at, state, vehicle_plate,
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .eq("created_by", me?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gate</h1>
        <Link href="/gate/intake" className="px-4 py-2 bg-black text-white rounded">
          + New visit intake
        </Link>
      </header>

      <section>
        <h2 className="font-semibold mb-2">Awaiting release ({awaiting.length})</h2>
        {awaiting.length === 0 ? (
          <p className="text-sm text-gray-600">No visits awaiting release.</p>
        ) : (
          <ul className="border rounded divide-y">
            {awaiting.map((v) => (
              <li key={v.id}>
                <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                  <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                  <div className="text-sm text-gray-600">
                    {v.declared_material_type?.name ?? "—"} · {v.vehicle_plate ?? "no plate"} ·{" "}
                    {formatTimestamp(v.created_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">My recent intakes</h2>
        {!recent || recent.length === 0 ? (
          <p className="text-sm text-gray-600">No recent intakes.</p>
        ) : (
          <ul className="border rounded divide-y">
            {recent.map((v) => {
              const supplier = v.supplier as unknown as { name?: string; phone?: string | null } | null;
              const mat = v.declared_material_type as unknown as { name?: string } | null;
              return (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                    <div className="font-medium">{supplier?.name ?? "—"}</div>
                    <div className="text-sm text-gray-600">
                      {mat?.name ?? "—"} · {v.vehicle_plate ?? "no plate"} · {v.state} ·{" "}
                      {formatTimestamp(v.created_at)}
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
