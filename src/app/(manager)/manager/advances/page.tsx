import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { setAdvanceApproval, deleteAdvance } from "./actions";
import { AdvanceForm } from "@/components/advances/AdvanceForm";
import { AdvanceEditForm } from "@/components/advances/AdvanceEditForm";
import { AdvanceShares } from "@/components/advances/AdvanceShares";
import { fetchKnownAccounts } from "@/lib/accounts/known-accounts";
import { ListControls } from "@/components/ui/ListControls";

import { one as g1 } from "@/lib/db/relation";

// Financial figures must never be served from cache — a stale balance reads as
// "the payment did not register". Always render fresh.
export const dynamic = "force-dynamic";
const ngn = (n: number) => `₦${n.toLocaleString()}`;

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "on_hold", label: "On hold" },
  { value: "rejected", label: "Rejected" },
];

export default async function ManagerAdvancesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = String(params.q ?? "").trim();
  const status = String(params.status ?? "");
  const me = await getProfile();
  const isOwner = me?.role === "owner";
  const canManage = me?.role === "manager" || isOwner;
  const supabase = await createClient();

  const { data: suppliers } = await supabase
    .from("suppliers").select("id, name, supplier_code").order("name").limit(300);
  const accounts = await fetchKnownAccounts();

  // Searched and filtered in Postgres (0138) — the list is capped at a page, so
  // filtering in the browser would only ever search the newest advances.
  let listQuery = supabase
    .from("advance_list")
    .select(`
      id, purpose, amount_naira, approval_status, created_at, comment,
      account_number, account_name, bank_name, supplier_name, supplier_code
    `)
    .order("created_at", { ascending: false })
    .limit(40);
  if (status) listQuery = listQuery.eq("approval_status", status);
  if (q) {
    const safe = q.replace(/[,()*%]/g, "");
    listQuery = listQuery.or(
      `supplier_name.ilike.%${safe}%,supplier_code.ilike.%${safe}%,purpose.ilike.%${safe}%,account_name.ilike.%${safe}%,account_number.ilike.%${safe}%`,
    );
  }
  const { data: advances } = await listQuery;

  // Apportioned shares for just the advances on screen.
  const advanceIds = (advances ?? []).map((a) => a.id as string);
  const { data: shareRows } = advanceIds.length
    ? await supabase.from("advance_shares")
        .select("id, advance_id, amount, note, supplier:suppliers(name)")
        .in("advance_id", advanceIds)
    : { data: [] as unknown[] };
  const sharesByAdvance = new Map<string, unknown[]>();
  for (const r of (shareRows ?? []) as { advance_id: string }[]) {
    const list = sharesByAdvance.get(r.advance_id) ?? [];
    list.push(r);
    sharesByAdvance.set(r.advance_id, list);
  }

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Supplier advances</h1>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Record an advance</h2></CardHeader>
        <CardContent>
          <AdvanceForm accounts={accounts} suppliers={(suppliers ?? []).map((s) => ({ id: s.id as string, name: s.name as string, code: (s.supplier_code as string | null) ?? null }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Advances ({advances?.length ?? 0})</h2></CardHeader>
        <CardContent className="p-0">
          <ListControls
            basePath="/manager/advances"
            query={q}
            status={status}
            options={STATUS_OPTIONS}
            placeholder="Search supplier, purpose, account…"
          />
          {(advances?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">
              {q || status ? "No advances match that search." : "No advances recorded."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {(advances ?? []).map((a) => {
                const sup = { name: a.supplier_name as string | null, supplier_code: a.supplier_code as string | null };
                const st = a.approval_status as string;
                return (
                  <li key={a.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="text-sm">
                      <div className="flex items-center gap-2">
                        <strong>{sup?.name ?? "—"}</strong>
                        {sup?.supplier_code && <Stamp>{sup.supplier_code}</Stamp>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.purpose as string} · {formatTimestamp(a.created_at as string)}
                      </div>
                      {(a.account_number || a.account_name || a.bank_name) && (
                        <div className="text-xs text-gray-500">
                          {(a.account_name as string | null) ?? "—"} · <span className="mono">{(a.account_number as string | null) ?? "—"}</span> · {(a.bank_name as string | null) ?? "—"}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ngn(Number(a.amount_naira))}</span>
                      <Badge variant={st === "approved" ? "green" : st === "rejected" ? "red" : "yellow"}>{st}</Badge>
                      {isOwner && st === "pending" && (
                        <>
                          <form action={setAdvanceApproval}>
                            <input type="hidden" name="advance_id" value={a.id as string} />
                            <input type="hidden" name="decision" value="approved" />
                            <button type="submit" className="rounded bg-approve px-2.5 py-0.5 text-xs text-white">Approve</button>
                          </form>
                          <form action={setAdvanceApproval}>
                            <input type="hidden" name="advance_id" value={a.id as string} />
                            <input type="hidden" name="decision" value="rejected" />
                            <button type="submit" className="rounded border px-2.5 py-0.5 text-xs">Reject</button>
                          </form>
                        </>
                      )}
                      {/* Manager/owner may delete an advance before it is paid. */}
                      {canManage && st !== "paid" && (
                        <form action={deleteAdvance}>
                          <input type="hidden" name="advance_id" value={a.id as string} />
                          <button type="submit" className="rounded border border-reject px-2.5 py-0.5 text-xs text-reject hover:bg-reject-soft">Delete</button>
                        </form>
                      )}
                    </div>
                    {/* One customer may have collected for a group — apportion the debt. */}
                    <div className="w-full">
                      <AdvanceShares
                        advanceId={a.id as string}
                        amount={Number(a.amount_naira)}
                        collector={sup?.name ?? "—"}
                        canEdit={canManage}
                        suppliers={(suppliers ?? [])
                          .filter((x) => (x.name as string) !== (sup?.name ?? ""))
                          .map((x) => ({ id: x.id as string, name: x.name as string, code: (x.supplier_code as string | null) ?? null }))}
                        shares={((sharesByAdvance.get(a.id as string) ?? []) as Record<string, unknown>[]).map((sh) => ({
                          id: sh.id as string,
                          amount: Number(sh.amount),
                          note: (sh.note as string | null) ?? null,
                          supplier: g1<{ name: string }>((sh as { supplier: unknown }).supplier)?.name ?? "—",
                        }))}
                      />
                    </div>

                    {/* Manager/owner may edit an advance before it is paid. */}
                    {canManage && st !== "paid" && (
                      <div className="w-full">
                        <AdvanceEditForm
                          accounts={accounts}
                          id={a.id as string}
                          purpose={a.purpose as string}
                          amount={Number(a.amount_naira)}
                          comment={(a.comment as string | null) ?? null}
                          accountName={(a.account_name as string | null) ?? null}
                          accountNumber={(a.account_number as string | null) ?? null}
                          bankName={(a.bank_name as string | null) ?? null}
                        />
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
