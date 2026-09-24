import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { setAdvanceApproval } from "@/app/(manager)/manager/advances/actions";
import { reviewExpense } from "@/app/(inventory)/inventory/consumables/actions";
import { ActionForm } from "@/components/ui/ActionForm";
import { approvePricing, rejectPricing } from "@/app/visits/[id]/batch-actions";

import { fetchFinanceFigures } from "@/lib/finance/figures";
import { one as g1 } from "@/lib/db/relation";

// Financial figures must never be served from cache — a stale balance reads as
// "the payment did not register". Always render fresh.
export const dynamic = "force-dynamic";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type LogEntry = {
  type: string;
  at: string;
  who: string | null;
  diff: Record<string, { old: unknown; new: unknown }> | null;
};

const FIELD_LABELS: Record<string, string> = {
  amount_naira: "Amount", amount: "Amount", purpose: "Purpose", name: "Name",
  category: "Category", comment: "Comment", entry_date: "Date",
  account_name: "Account name", account_number: "Account number", bank_name: "Bank",
  site_id: "Site", supplier_id: "Supplier", approval_status: "Status",
};
// Bookkeeping columns the operator never set; showing them as "changes" would
// bury the one line that matters.
const NOISE = new Set(["revision", "request_key", "updated_at", "approved_at", "approved_by"]);

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

/** What was submitted, who submitted it, and everything that happened since. */
function DetailPanel({
  rows, log, accounts,
}: {
  rows: Array<[string, React.ReactNode]>;
  log: LogEntry[];
  accounts?: { name: unknown; number: unknown; bank: unknown };
}) {
  const edits = log.filter((l) => l.type === "record_edited" && l.diff
    && Object.keys(l.diff).some((k) => !NOISE.has(k)));
  const created = log.find((l) => l.type === "record_created");
  return (
    <details className="mt-2 w-full">
      <summary className="cursor-pointer text-xs font-medium text-ink-2 hover:underline">
        Details{edits.length > 0 ? ` · edited ${edits.length}×` : ""}
      </summary>
      <div className="mt-2 space-y-3 rounded border border-line bg-paper px-3 py-2">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-ink-2">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        {accounts && Boolean(accounts.name || accounts.number || accounts.bank) && (
          <div className="text-xs">
            <div className="mb-1 font-semibold text-ink-2">Payment account</div>
            <div className="text-ink-2">
              {fmt(accounts.name)} · {fmt(accounts.number)} · {fmt(accounts.bank)}
            </div>
          </div>
        )}

        <div className="text-xs">
          <div className="mb-1 font-semibold text-ink-2">History</div>
          {log.length === 0 ? (
            <p className="text-ink-2">No recorded activity.</p>
          ) : (
            <ul className="space-y-1">
              {created && (
                <li className="text-ink-2">
                  Submitted {formatTimestamp(created.at)}
                  {created.who ? ` by ${created.who}` : ""}
                </li>
              )}
              {edits.map((e, i) => (
                <li key={i} className="text-ink-2">
                  <span>Edited {formatTimestamp(e.at)}{e.who ? ` by ${e.who}` : ""}</span>
                  <ul className="ml-4 list-disc">
                    {Object.entries(e.diff ?? {})
                      .filter(([k]) => !NOISE.has(k))
                      .map(([k, v]) => (
                        <li key={k}>
                          {FIELD_LABELS[k] ?? k.replace(/_/g, " ")}:{" "}
                          <span className="text-reject line-through">{fmt(v.old)}</span>{" → "}
                          <span className="font-medium text-ink">{fmt(v.new)}</span>
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
              {edits.length === 0 && created && (
                <li className="text-ink-2">Unchanged since it was submitted.</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

export default async function OwnerApprovalsPage() {
  const supabase = await createClient();

  // Money figures come from the canonical source so every module agrees.
  const [{ data: balances }, { data: pendingAdvances }, figures] = await Promise.all([
    supabase.from("stock_balances").select("material_name, weight_kg"),
    supabase.from("advances")
      .select(`
        id, purpose, amount_naira, created_at, revision, comment,
        account_name, account_number, bank_name,
        supplier:suppliers(name, supplier_code),
        site:sites(name),
        recorded_by_profile:profiles!advances_recorded_by_fkey(full_name),
        shares:advance_shares(amount, note, supplier:suppliers(name))
      `)
      .eq("approval_status", "pending").order("created_at", { ascending: true }),
    fetchFinanceFigures(),
  ]);

  // What the store keeper found missing or short — stock the books claim but
  // the store does not have.
  const { data: disputes } = await supabase
    .from("stock_confirmations")
    .select(`
      stock_lot_id, counted_weight_kg, dispute_note, updated_at,
      lot:stock_lots(weight_kg, material:material_types(name), site:sites(name)),
      keeper:profiles!stock_confirmations_checked_by_fkey(full_name)
    `)
    .eq("status", "disputed")
    .order("updated_at", { ascending: false });

  const { data: pendingExpenses } = await supabase
    .from("consumables")
    .select(`
      id, name, category, amount_naira, entry_date, revision, comment, created_at,
      account_name, account_number, bank_name,
      site:sites(name),
      recorded_by_profile:profiles!consumables_recorded_by_fkey(full_name)
    `)
    .eq("approval_status", "pending")
    .order("entry_date", { ascending: true });

  // Batches the manager has priced, awaiting the owner's approval (#1/#5).
  const { data: pendingPrices } = await supabase
    .from("visits")
    .select("id, created_at, supplier:suppliers(name), declared_material_type:material_types(name), site:sites(name), pricing:pricing(purchase_amount), materials:visit_materials(weight_kg, unit_price, purchase_amount, magnetic_analysis, material:material_types(name), xrf:xrf_records(result, weight_kg, submitted))")
    .eq("state", "awaiting_price_approval")
    .order("created_at", { ascending: true });

  // 0162: each pending batch carries the fingerprint of the pricing on screen,
  // so an approval that arrives after a reprice is refused instead of freezing
  // a figure the owner never saw.
  const pricingTokens = new Map<string, string>();
  await Promise.all((pendingPrices ?? []).map(async (v) => {
    const { data } = await supabase.rpc("pricing_review_token", { p_visit_id: v.id as string });
    if (data) pricingTokens.set(v.id as string, data as string);
  }));

  // The history behind each pending item. The owner approves an exact revision
  // (0162), so what they most need before ruling is whether the figure moved
  // after it was submitted — an expense edited from ₦9,000 to ₦15,000 reads
  // very differently from one that never changed.
  const pendingIds = [
    ...(pendingAdvances ?? []).map((a) => a.id as string),
    ...(pendingExpenses ?? []).map((e) => e.id as string),
  ];
  const logs = new Map<string, LogEntry[]>();
  if (pendingIds.length) {
    const { data: events } = await supabase
      .from("transaction_events")
      .select("entity_id, event_type, created_at, payload, actor:profiles!transaction_events_actor_id_fkey(full_name)")
      .in("entity_id", pendingIds)
      .order("created_at", { ascending: true });
    for (const ev of events ?? []) {
      const key = ev.entity_id as string;
      const actor = g1<{ full_name: string }>((ev as { actor: unknown }).actor);
      logs.set(key, [...(logs.get(key) ?? []), {
        type: ev.event_type as string,
        at: ev.created_at as string,
        who: actor?.full_name ?? null,
        diff: ((ev.payload as { diff?: Record<string, { old: unknown; new: unknown }> })?.diff) ?? null,
      }]);
    }
  }

  // Overview: materials on hand (ledger balance, aggregated in SQL — see 0121),
  // light bills deducted, advances out. Per-site buckets roll up per material.
  const onHand = new Map<string, number>();
  for (const b of balances ?? []) {
    const name = (b.material_name as string) ?? "—";
    onHand.set(name, (onHand.get(name) ?? 0) + Number(b.weight_kg));
  }
  const onHandRows = [...onHand.entries()].filter(([, kg]) => kg > 0.0005).sort((a, b) => a[0].localeCompare(b[0]));
  const { feesNetted, feesCash, feesRecovered, feesCollected: lightBillsDeducted,
          advancesPaidOut: advancesPaid, advancesRecovered, advancesOutstanding: advancesOut } = figures;

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Approvals &amp; overview</h1>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Processing fees collected</h2></CardHeader>
          <CardContent>
            <div className="mono text-2xl font-bold text-ink">{ngn(lightBillsDeducted)}</div>
            <p className="text-xs text-ink-2">
              {ngn(feesNetted)} deducted{feesCash > 0 ? ` · ${ngn(feesCash)} cash` : ""}{feesRecovered > 0 ? ` · ${ngn(feesRecovered)} recovered` : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Advances outstanding</h2></CardHeader>
          <CardContent>
            <div className="mono text-2xl font-bold text-ink">{ngn(advancesOut)}</div>
            <p className="text-xs text-ink-2">{ngn(advancesPaid)} paid out · {ngn(advancesRecovered)} recovered</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Pending approvals</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ore">{(pendingPrices?.length ?? 0) + (pendingAdvances?.length ?? 0) + (pendingExpenses?.length ?? 0)}</div></CardContent>
        </Card>
      </div>

      {(disputes ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Store disputes</h2>
              <Badge variant="red">{disputes!.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-line text-sm">
              {disputes!.map((d) => {
                const lot = g1<{ weight_kg: number; material: unknown; site: unknown }>((d as { lot: unknown }).lot);
                const found = d.counted_weight_kg != null ? Number(d.counted_weight_kg) : null;
                return (
                  <li key={d.stock_lot_id as string} className="px-4 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {g1<{ name: string }>(lot?.material)?.name ?? "—"}
                        <span className="ml-2 text-xs text-ink-2">{g1<{ name: string }>(lot?.site)?.name ?? "—"}</span>
                      </span>
                      <span className="mono text-xs">
                        books {Number(lot?.weight_kg ?? 0).toFixed(3)} kg
                        {found != null ? ` · found ${found.toFixed(3)} kg` : " · not found"}
                      </span>
                    </div>
                    <p className="text-xs text-reject">{d.dispute_note as string}</p>
                    <p className="text-[11px] text-ink-2">
                      {g1<{ full_name: string }>((d as { keeper: unknown }).keeper)?.full_name ?? "—"} · {formatTimestamp(d.updated_at as string)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Materials at hand</h2></CardHeader>
        <CardContent className="p-0">
          {onHandRows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No stock on hand.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {onHandRows.map(([name, kg]) => (
                <li key={name} className="flex items-center justify-between px-4 py-2">
                  <span>{name}</span><span className="mono font-medium">{kg.toFixed(3)} kg</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Prices awaiting owner approval (#1/#5) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Prices awaiting approval</h2>
            <Badge variant={pendingPrices?.length ? "yellow" : "default"}>{pendingPrices?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(pendingPrices?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No prices pending approval.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingPrices ?? []).map((v) => {
                const sup = g1<{ name: string }>((v as { supplier: unknown }).supplier);
                const site = g1<{ name: string }>((v as { site: unknown }).site);
                const pr = g1<{ purchase_amount: number }>((v as { pricing: unknown }).pricing);
                const lines = ((v as { materials: unknown }).materials ?? []) as {
                  weight_kg: number; unit_price: number | null; magnetic_analysis: string | null; material: unknown; xrf: unknown;
                }[];
                return (
                  <li key={v.id as string} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/visits/${v.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                        <Stamp>{(v.id as string).slice(0, 8).toUpperCase()}</Stamp>
                        <strong>{sup?.name ?? "—"}</strong>
                        <span className="text-ink-2">· {site?.name ?? "—"} · {formatTimestamp(v.created_at as string)}</span>
                        {pr?.purchase_amount != null && <span className="font-medium">· Total {ngn(Number(pr.purchase_amount))}</span>}
                      </Link>
                      <div className="flex shrink-0 gap-2">
                        {/* ActionForm is the client wrapper; this page stays a
                            server component and just hands it the action. */}
                        <ActionForm action={approvePricing}>
                          <input type="hidden" name="visit_id" value={v.id as string} />
                          {/* 0162: the pricing version this row is showing. */}
                          <input type="hidden" name="reviewed_token" value={pricingTokens.get(v.id as string) ?? ""} />
                          <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve &amp; finalize</button>
                        </ActionForm>
                        <ActionForm action={rejectPricing}>
                          <input type="hidden" name="visit_id" value={v.id as string} />
                          <button type="submit" className="rounded border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50">Send back</button>
                        </ActionForm>
                      </div>
                    </div>
                    {/* Per-material breakdown: type · kg · unit price */}
                    <ul className="mt-2 space-y-0.5 border-l-2 border-line pl-3 text-xs text-ink-2">
                      {lines.length === 0 ? (
                        <li>No material lines.</li>
                      ) : lines.map((l, i) => {
                        const name = g1<{ name: string }>(l.material)?.name ?? "—";
                        const kg = Number(l.weight_kg ?? 0);
                        const xrf = g1<{ result: string | null; weight_kg: number | null; submitted: boolean }>(l.xrf);
                        return (
                          <li key={i} className="mb-1">
                            <span className="font-medium text-ink">{name}</span>
                            {" · "}{kg.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg
                            {" · "}{l.unit_price != null ? `${ngn(Number(l.unit_price))}/kg` : "unpriced"}
                            {/* The analyses this price rests on: magnetic (receiving) + XRF (QC). */}
                            <span className="block">
                              <span className="text-ore">Magnetic: {l.magnetic_analysis?.trim() || "—"}</span>
                              {" · "}
                              XRF: {xrf?.result?.trim() || "—"}
                              {xrf?.weight_kg != null ? ` (QC ${Number(xrf.weight_kg).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg)` : ""}
                              {xrf && !xrf.submitted ? " · draft" : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Supplier payments need no separate approval — the owner's price approval
          counts as the payment approval, so an assembled settlement goes straight
          to accounting. */}

      {/* Pending advances */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Advances awaiting approval</h2>
            <Badge variant={pendingAdvances?.length ? "yellow" : "default"}>{pendingAdvances?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(pendingAdvances?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No advances pending.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingAdvances ?? []).map((a) => {
                const sup = g1<{ name: string; supplier_code: string | null }>((a as { supplier: unknown }).supplier);
                const site = g1<{ name: string }>((a as { site: unknown }).site);
                const by = g1<{ full_name: string }>((a as { recorded_by_profile: unknown }).recorded_by_profile);
                // database.types.ts declares no relationships, so embedded rows are
                // read through a cast here, as the rest of this page does.
                const shares = ((a as unknown as { shares?: Array<{ amount: number; note: string | null; supplier: unknown }> }).shares) ?? [];
                return (
                  <li key={a.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <strong>{sup?.name ?? "—"}</strong>
                      {sup?.supplier_code && <Stamp>{sup.supplier_code}</Stamp>}
                      <span className="text-ink-2">{a.purpose as string}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ngn(Number(a.amount_naira))}</span>
                      {/* Each ActionForm owns its own state, so a refusal shows
                          on the row and the button that caused it. */}
                      <ActionForm action={setAdvanceApproval}>
                        <input type="hidden" name="advance_id" value={a.id as string} />
                        {/* 0162: the row carries the version the owner is looking at. */}
                        <input type="hidden" name="reviewed_revision" value={String(a.revision)} />
                        <input type="hidden" name="decision" value="approved" />
                        <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve</button>
                      </ActionForm>
                      <ActionForm action={setAdvanceApproval}>
                        <input type="hidden" name="advance_id" value={a.id as string} />
                        <input type="hidden" name="reviewed_revision" value={String(a.revision)} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button type="submit" className="rounded border px-3 py-1 text-xs">Reject</button>
                      </ActionForm>
                    </div>
                    <DetailPanel
                      rows={[
                        ["Supplier", sup?.name ?? "—"],
                        ["Purpose", (a.purpose as string) ?? "—"],
                        ["Amount", ngn(Number(a.amount_naira))],
                        ["Site", site?.name ?? "—"],
                        ["Submitted by", by?.full_name ?? "—"],
                        ["Submitted", formatTimestamp(a.created_at as string)],
                        ["Note", (a.comment as string) || "—"],
                        ...(shares.length
                          ? [["Shared with", shares.map((sh) => {
                              const shSup = g1<{ name: string }>(sh.supplier);
                              return `${shSup?.name ?? "—"} ${ngn(Number(sh.amount))}`;
                            }).join(", ")] as [string, React.ReactNode]]
                          : []),
                      ]}
                      accounts={{ name: a.account_name, number: a.account_number, bank: a.bank_name }}
                      log={logs.get(a.id as string) ?? []}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pending expenses (consumables) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Expenses awaiting approval</h2>
            <Badge variant={pendingExpenses?.length ? "yellow" : "default"}>{pendingExpenses?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(pendingExpenses?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No expenses pending.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingExpenses ?? []).map((e) => {
                const site = g1<{ name: string }>((e as { site: unknown }).site);
                const by = g1<{ full_name: string }>((e as { recorded_by_profile: unknown }).recorded_by_profile);
                return (
                  <li key={e.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div>
                      <strong>{e.name as string}</strong>
                      <span className="text-ink-2"> · {String(e.category).replace(/_/g, " ")} · {site?.name ?? "—"} · {e.entry_date as string}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.amount_naira != null ? ngn(Number(e.amount_naira)) : "—"}</span>
                      <ActionForm action={reviewExpense}>
                        <input type="hidden" name="consumable_id" value={e.id as string} />
                        <input type="hidden" name="reviewed_revision" value={String(e.revision)} />
                        <input type="hidden" name="decision" value="approved" />
                        <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve</button>
                      </ActionForm>
                      <ActionForm action={reviewExpense}>
                        <input type="hidden" name="consumable_id" value={e.id as string} />
                        <input type="hidden" name="reviewed_revision" value={String(e.revision)} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button type="submit" className="rounded border px-3 py-1 text-xs">Reject</button>
                      </ActionForm>
                    </div>
                    <DetailPanel
                      rows={[
                        ["Expense", (e.name as string) ?? "—"],
                        ["Category", String(e.category).replace(/_/g, " ")],
                        ["Amount", e.amount_naira != null ? ngn(Number(e.amount_naira)) : "—"],
                        ["Site", site?.name ?? "—"],
                        ["Date of spend", (e.entry_date as string) ?? "—"],
                        ["Submitted by", by?.full_name ?? "—"],
                        ["Submitted", formatTimestamp(e.created_at as string)],
                        ["Note", (e.comment as string) || "—"],
                      ]}
                      accounts={{ name: e.account_name, number: e.account_number, bank: e.bank_name }}
                      log={logs.get(e.id as string) ?? []}
                    />
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
