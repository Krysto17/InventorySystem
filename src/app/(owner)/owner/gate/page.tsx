import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { GateMovementsCard } from "@/components/gate/GateMovementsCard";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

const STATUS_VARIANT: Record<string, "default" | "green" | "yellow" | "red"> = {
  issued: "yellow", acknowledged: "green", cancelled: "red",
};

// The director's gate oversight: every pass + every movement across all sites.
export default async function OwnerGatePage() {
  const supabase = await createClient();
  const { data: passes } = await supabase
    .from("gate_passes")
    .select("id, pass_code, material_owner, reason, status, issued_at, site:sites(name), material:material_types(name), supplier:suppliers(name)")
    .order("issued_at", { ascending: false })
    .limit(40);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Gate oversight</h1>
      </div>

      <GateMovementsCard showSite limit={100} />

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Gate passes ({passes?.length ?? 0})</h2></CardHeader>
        <CardContent className="p-0">
          {(passes?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No gate passes.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(passes ?? []).map((p) => {
                const site = g1<{ name: string }>((p as { site: unknown }).site);
                const mat = g1<{ name: string }>((p as { material: unknown }).material);
                const sup = g1<{ name: string }>((p as { supplier: unknown }).supplier);
                const st = p.status as string;
                return (
                  <li key={p.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stamp>{p.pass_code as string}</Stamp>
                      {site?.name && <Badge variant="default">{site.name}</Badge>}
                      <span>{sup?.name ?? p.material_owner ?? "—"} · {mat?.name ?? "—"} · {p.reason as string}</span>
                      <span className="text-ink-2">{formatTimestamp(p.issued_at as string)}</span>
                    </div>
                    <Badge variant={STATUS_VARIANT[st] ?? "default"}>{st}</Badge>
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
