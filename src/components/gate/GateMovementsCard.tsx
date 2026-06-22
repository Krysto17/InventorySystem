import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";

import { one as g1 } from "@/lib/db/relation";

// All gate movements (in/out). Owner + manager have cross-site read, so they see
// every site; the gate sees its own. `showSite` adds the site column for the
// cross-site viewers.
export async function GateMovementsCard({ limit = 50, showSite = false }: { limit?: number; showSite?: boolean }) {
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("gate_logs")
    .select(`
      id, direction, driver_name, driver_phone, bags, material_owner, reason, created_at,
      site:sites(name),
      pass:gate_passes(pass_code)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Gate movements</h2>
          <Badge variant={logs?.length ? "default" : "default"}>{logs?.length ?? 0}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {(logs?.length ?? 0) === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-2">No movements logged.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {(logs ?? []).map((l) => {
              const site = g1<{ name: string }>((l as { site: unknown }).site);
              const pass = g1<{ pass_code: string }>((l as { pass: unknown }).pass);
              return (
                <li key={l.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={l.direction === "in" ? "approved" : "review"}>
                      {(l.direction as string).toUpperCase()}
                    </Badge>
                    {showSite && site?.name && <Badge variant="default">{site.name}</Badge>}
                    <span className="font-medium">{l.material_owner ?? "—"}</span>
                    <span className="text-ink-2">
                      {l.driver_name ? ` · ${l.driver_name}` : ""}
                      {l.driver_phone ? ` (${l.driver_phone})` : ""}
                      {l.bags != null ? ` · ${l.bags} bags` : ""}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </span>
                    {pass?.pass_code && <Stamp>{pass.pass_code}</Stamp>}
                  </span>
                  <span className="text-ink-2">{formatTimestamp(l.created_at as string)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
