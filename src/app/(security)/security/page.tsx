import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { recordGateLog, acknowledgeGatePass } from "./actions";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

export default async function SecurityHomePage() {
  const supabase = await createClient();
  const [{ data: issued }, { data: logs }, { data: passOptions }] = await Promise.all([
    supabase.from("gate_passes")
      .select("id, pass_code, material_owner, reason, bags, weight_kg, status, issued_at, material:material_types(name)")
      .eq("status", "issued").order("issued_at", { ascending: true }),
    supabase.from("gate_logs")
      .select("id, direction, driver_name, bags, material_owner, reason, created_at")
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("gate_passes").select("id, pass_code").eq("status", "issued"),
  ]);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Gate — Security</h1>
        <p className="text-sm text-gray-500">Register material movement; acknowledge issued gate passes before release.</p>
      </header>

      {/* Outgoing passes awaiting acknowledgement */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Gate passes awaiting acknowledgement</h2>
            <Badge variant={issued?.length ? "yellow" : "default"}>{issued?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(issued?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No gate passes to acknowledge.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(issued ?? []).map((p) => {
                const mat = g1<{ name: string }>((p as { material: unknown }).material);
                return (
                  <li key={p.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stamp>{p.pass_code as string}</Stamp>
                      <span>{p.material_owner ?? "—"} · {mat?.name ?? "—"}{p.bags != null ? ` · ${p.bags} bags` : ""}</span>
                      <span className="text-ink-2">· {p.reason as string}</span>
                    </div>
                    <form action={acknowledgeGatePass}>
                      <input type="hidden" name="pass_id" value={p.id as string} />
                      <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Acknowledge &amp; release</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Register movement */}
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Register material movement</h2></CardHeader>
        <CardContent>
          <form action={recordGateLog} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium">Direction
              <select name="direction" defaultValue="in" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
                <option value="in">Incoming</option>
                <option value="out">Outgoing</option>
              </select>
            </label>
            <label className="text-xs font-medium">Driver name
              <input type="text" name="driver_name" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Driver phone
              <input type="text" name="driver_phone" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Material owner
              <input type="text" name="material_owner" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Bags
              <input type="number" name="bags" min="0" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Gate pass (if outgoing)
              <select name="gate_pass_id" defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
                <option value="">—</option>
                {(passOptions ?? []).map((p) => (
                  <option key={p.id as string} value={p.id as string}>{p.pass_code as string}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-xs font-medium sm:col-span-3">Reason / note
              <input type="text" name="reason" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="col-span-2 rounded bg-ink px-4 py-1.5 text-sm font-semibold text-white sm:col-span-3">
              Register movement
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Recent movements */}
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Recent movements</h2></CardHeader>
        <CardContent className="p-0">
          {(logs?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No movements logged.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {(logs ?? []).map((l) => (
                <li key={l.id as string} className="flex items-center justify-between px-4 py-2">
                  <span className="flex items-center gap-2">
                    <Badge variant={l.direction === "in" ? "approved" : "review"}>{(l.direction as string).toUpperCase()}</Badge>
                    {l.material_owner ?? "—"}{l.driver_name ? ` · ${l.driver_name}` : ""}{l.bags != null ? ` · ${l.bags} bags` : ""}
                  </span>
                  <span className="text-ink-2">{formatTimestamp(l.created_at as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
