import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { formatTimestamp } from "@/lib/visits/format";

// What every account has actually done. Filtered in Postgres — this table gains
// a row per action forever, so the page holds the matches rather than the log.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 300;

const EVENT_LABEL: Record<string, string> = {
  visit_created: "created a visit",
  state_changed: "moved a batch",
  record_created: "added",
  record_edited: "changed",
  record_deleted: "removed",
  gate_exit_authorized: "authorised an exit",
  gate_released: "released material",
  owner_override: "overrode",
};

// The table name is how the database says it; this is how the business does.
const ENTITY_LABEL: Record<string, string> = {
  consumables: "an expense",
  advances: "an advance",
  advance_shares: "an advance share",
  settlement_payments: "a payment",
  settlement_payout_splits: "a payout split",
  price_corrections: "a price correction",
  cost_price_runs: "a cost-price run",
  stock_confirmations: "a store check",
  bulk_sales: "a bulk sale",
  lot_sales: "a lot sale",
  stock_lots: "a stock lot",
  stock_movements: "stock",
  suppliers: "a supplier",
  gate_passes: "a gate pass",
  profiles: "a user account",
  visit_materials: "a material line",
  batch_settlements: "a settlement",
  xrf_records: "an XRF result",
  analysis_records: "an analysis",
  processing_records: "a processing record",
  utility_charges: "a light bill",
  pricing: "a price",
  payments: "a payment",
  advance_deductions: "an advance deduction",
  visit: "a visit",
};

export default async function OwnerAuditPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getProfile();
  if (!me || me.role !== "owner") redirect("/login");

  const params = await searchParams;
  const actor = String(params.actor ?? "");
  const entity = String(params.entity ?? "");

  const supabase = await createClient();
  const [{ data: staff }, { data: perActor }] = await Promise.all([
    supabase.from("profiles").select("id, username, full_name, role").order("username"),
    supabase.rpc("audit_counts_by_actor"),
  ]);

  let query = supabase
    .from("audit_trail")
    .select("id, created_at, event_type, entity, entity_id, visit_id, site_name, actor_id, actor_username, actor_name, actor_role, payload")
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT);
  if (actor) query = query.eq("actor_id", actor);
  if (entity) query = query.eq("entity", entity);
  const { data: events } = await query;

  const counts = new Map(
    ((perActor ?? []) as { actor_id: string; events: number; last_seen: string | null }[])
      .map((r) => [r.actor_id, r]),
  );
  const selected = (staff ?? []).find((s) => s.id === actor);

  const link = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { actor, entity, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/owner/audit${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Audit trail</h1>
      </header>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">By account</h2></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-2">Account</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2 text-right">Recorded actions</th>
                  <th className="px-4 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(staff ?? []).map((s) => {
                  const c = counts.get(s.id as string);
                  const n = Number(c?.events ?? 0);
                  return (
                    <tr key={s.id as string} className={actor === s.id ? "bg-zinc-50 dark:bg-zinc-800/50" : ""}>
                      <td className="px-4 py-2">
                        <Link href={link({ actor: actor === s.id ? "" : (s.id as string) })} className="font-medium hover:underline">
                          {(s.full_name as string) || (s.username as string)}
                        </Link>
                        <span className="block text-xs text-ink-2">{s.username as string}</span>
                      </td>
                      <td className="px-4 py-2 text-ink-2">{s.role as string}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${n === 0 ? "text-reject font-semibold" : ""}`}>
                        {n.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-2">
                        {c?.last_seen ? formatTimestamp(c.last_seen) : "never"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {selected
                ? `What ${(selected.full_name as string) || (selected.username as string)} did`
                : "Everything recorded"}
              {" "}({events?.length ?? 0}{(events?.length ?? 0) === PAGE_LIMIT ? "+" : ""})
            </h2>
            {(actor || entity) && (
              <Link href="/owner/audit" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50">
                Clear filter
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!events || events.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing recorded for this filter.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {events.map((e) => {
                const ent = (e.entity as string) ?? "visit";
                const diff = (e.payload as { diff?: Record<string, { old: unknown; new: unknown }> })?.diff;
                return (
                  <li key={e.id as string} className="px-4 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <span className="font-medium">{(e.actor_name as string) || (e.actor_username as string) || "—"}</span>
                        <span className="text-ink-2">
                          {" "}{EVENT_LABEL[e.event_type as string] ?? (e.event_type as string)}{" "}
                          {ENTITY_LABEL[ent] ?? ent}
                        </span>
                        {e.visit_id && (
                          <Link href={`/visits/${e.visit_id}`} className="ml-2 text-xs underline">on this batch</Link>
                        )}
                      </span>
                      <span className="text-xs text-ink-2">
                        {e.site_name ? `${e.site_name} · ` : ""}{formatTimestamp(e.created_at as string)}
                      </span>
                    </div>
                    {diff && Object.keys(diff).length > 0 && (
                      <div className="mt-0.5 text-xs text-ink-2">
                        {Object.entries(diff).slice(0, 4).map(([k, v]) => (
                          <span key={k} className="mr-3">
                            {k}: <span className="line-through">{String(v.old ?? "—")}</span> → <span className="text-ink">{String(v.new ?? "—")}</span>
                          </span>
                        ))}
                      </div>
                    )}
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
