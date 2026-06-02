import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gate</h1>
          <p className="text-sm text-gray-500">{me?.full_name ?? me?.username}</p>
        </div>
        <Link href="/gate/intake" className="px-4 py-2 bg-black text-white rounded text-sm">
          + New visit intake
        </Link>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Awaiting release</h2>
            <Badge variant="red">{awaiting.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {awaiting.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No visits awaiting release.</p>
          ) : (
            <ul className="divide-y">
              {awaiting.map((v) => (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-4 py-3 hover:bg-gray-50">
                    <div className="font-medium text-sm">{v.supplier?.name ?? "—"}</div>
                    <div className="text-xs text-gray-500">
                      {v.declared_material_type?.name ?? "—"} · {v.vehicle_plate ?? "no plate"} ·{" "}
                      {formatTimestamp(v.created_at)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-sm">My recent intakes</h2>
        </CardHeader>
        <CardContent className="p-0">
          {!recent || recent.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No recent intakes.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((v) => {
                const supplier = v.supplier as unknown as { name?: string; phone?: string | null } | null;
                const mat = v.declared_material_type as unknown as { name?: string } | null;
                return (
                  <li key={v.id}>
                    <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{supplier?.name ?? "—"}</div>
                        <div className="text-xs text-gray-500">
                          {mat?.name ?? "—"} · {v.vehicle_plate ?? "no plate"}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="default">{v.state}</Badge>
                        <div className="text-xs text-gray-400 mt-1">{formatTimestamp(v.created_at)}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
