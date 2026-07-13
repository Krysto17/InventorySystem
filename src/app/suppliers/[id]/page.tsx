import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { SupplierEditForms } from "@/components/suppliers/SupplierEditForms";
import { DeleteSupplierButton } from "@/components/suppliers/DeleteSupplierButton";
import { formatTimestamp } from "@/lib/visits/format";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";
import { one as g1 } from "@/lib/db/relation";

type FormerAccount = { account_name?: string | null; account_number?: string | null; bank_name?: string | null; replaced_at?: string };
const ngn = (n: number) => `₦${n.toLocaleString()}`;

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getProfile();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("suppliers")
    .select("id, name, phone, supplier_code, former_names, former_accounts, account_name, account_number, bank_name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();

  const formerNames = (s.former_names as string[] | null) ?? [];
  const formerAccounts = (s.former_accounts as FormerAccount[] | null) ?? [];
  const canEdit = me.role === "manager" || me.role === "owner";

  // Manager + owner get the full profile the owner sees (visits / advances /
  // lots), RLS-scoped to what they may read (site managers → own site).
  const [{ data: visits }, { data: advances }, { data: lots }] = canEdit
    ? await Promise.all([
        supabase.from("visits").select("id, state, entry_path, created_at, site:sites(name)")
          .eq("supplier_id", id).order("created_at", { ascending: false }).limit(50),
        supabase.from("advances").select("id, purpose, amount_naira, approval_status, created_at")
          .eq("supplier_id", id).order("created_at", { ascending: false }),
        supabase.from("stock_lots").select("id, weight_kg, cost_price_per_kg, status, material:material_types(name)")
          .eq("supplier_id", id).order("created_at", { ascending: false }).limit(50),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const approvedAdvances = (advances ?? [])
    .filter((a) => a.approval_status === "approved")
    .reduce((sum, a) => sum + Number(a.amount_naira), 0);
  // A supplier with any visit, advance or stock lot cannot be deleted (the RPC
  // also re-checks every reference server-side).
  const hasRecords = (visits?.length ?? 0) > 0 || (advances?.length ?? 0) > 0 || (lots?.length ?? 0) > 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/suppliers" className="text-sm text-gray-500 hover:underline">← Suppliers</Link>
        <h1 className="text-2xl font-bold">{s.name as string}</h1>
        <Badge variant="blue">{(s.supplier_code as string | null) ?? "no code"}</Badge>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Profile</h2></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Phone: {(s.phone as string | null) ?? "—"}</div>
          {formerNames.length > 0 && <div className="text-gray-500">Previous names: {formerNames.join(", ")}</div>}
          {canEdit && <div>Approved advances to date: <strong>{ngn(approvedAdvances)}</strong></div>}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Edit supplier</h2></CardHeader>
          <CardContent>
            <SupplierEditForms
              supplier={{
                id: s.id as string,
                name: s.name as string,
                account_name: (s.account_name as string | null) ?? null,
                account_number: (s.account_number as string | null) ?? null,
                bank_name: (s.bank_name as string | null) ?? null,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Account details</h2></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="rounded border border-line p-2">
            <div className="text-[11px] font-medium text-ink-2">Current</div>
            {s.account_number ? (
              <div>{(s.account_name as string | null) ?? "—"} · <span className="mono">{s.account_number as string}</span> · {(s.bank_name as string | null) ?? "—"}</div>
            ) : (
              <div className="text-gray-500">No account details on file.</div>
            )}
          </div>
          {formerAccounts.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-ink-2">Previous accounts ({formerAccounts.length})</div>
              <ul className="mt-1 space-y-1">
                {formerAccounts.slice().reverse().map((a, i) => (
                  <li key={i} className="rounded bg-zinc-50 px-2 py-1 text-xs text-gray-600 dark:bg-zinc-800/50">
                    {a.account_name ?? "—"} · <span className="mono">{a.account_number ?? "—"}</span> · {a.bank_name ?? "—"}
                    {a.replaced_at && <span className="text-gray-400"> · until {new Date(a.replaced_at).toLocaleDateString()}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <>
          <Card>
            <CardHeader><h2 className="text-sm font-semibold">Visits ({visits?.length ?? 0})</h2></CardHeader>
            <CardContent className="p-0">
              {(visits?.length ?? 0) === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">No visits.</p>
              ) : (
                <ul className="divide-y">
                  {(visits ?? []).map((v) => {
                    const site = g1<{ name: string }>((v as { site: unknown }).site);
                    const state = v.state as VisitState;
                    return (
                      <li key={v.id as string}>
                        <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                          <div className="text-sm">{site?.name ?? "—"} · {v.entry_path as string} · {formatTimestamp(v.created_at as string)}</div>
                          <Badge variant={stateVariant(state)}>{STATE_LABELS[state] ?? state}</Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="text-sm font-semibold">Advances ({advances?.length ?? 0})</h2></CardHeader>
            <CardContent className="p-0">
              {(advances?.length ?? 0) === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">No advances.</p>
              ) : (
                <ul className="divide-y">
                  {(advances ?? []).map((a) => (
                    <li key={a.id as string} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span>{a.purpose as string} · {formatTimestamp(a.created_at as string)}</span>
                      <span className="flex items-center gap-2">
                        {ngn(Number(a.amount_naira))}
                        <Badge variant={a.approval_status === "approved" ? "green" : a.approval_status === "rejected" ? "red" : "yellow"}>{a.approval_status as string}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="text-sm font-semibold">Stock lots from this supplier</h2></CardHeader>
            <CardContent className="p-0">
              {(lots?.length ?? 0) === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">No lots.</p>
              ) : (
                <ul className="divide-y">
                  {(lots ?? []).map((l) => {
                    const mat = g1<{ name: string }>((l as { material: unknown }).material);
                    return (
                      <li key={l.id as string} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span>{mat?.name ?? "—"} · {Number(l.weight_kg).toFixed(3)} kg</span>
                        <span className="flex items-center gap-2">
                          {l.cost_price_per_kg != null ? `${ngn(Number(l.cost_price_per_kg))}/kg` : "—"}
                          <Badge variant={l.status === "available" ? "green" : "default"}>{l.status as string}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="text-sm font-semibold">Delete supplier</h2></CardHeader>
            <CardContent>
              <DeleteSupplierButton supplierId={s.id as string} hasRecords={hasRecords} />
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
