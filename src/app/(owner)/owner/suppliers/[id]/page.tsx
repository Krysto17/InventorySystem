import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";

import { one as g1 } from "@/lib/db/relation";

const ngn = (n: number) => `₦${n.toLocaleString()}`;

export default async function SupplierProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, phone, notes, supplier_code, former_names, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!supplier) notFound();

  const [{ data: visits }, { data: advances }, { data: lots }] = await Promise.all([
    supabase
      .from("visits")
      .select("id, state, entry_path, created_at, site:sites(name)")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("advances")
      .select("id, purpose, amount_naira, approval_status, created_at")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("stock_lots")
      .select("id, weight_kg, cost_price_per_kg, status, material:material_types(name)")
      .eq("supplier_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const formerNames = (supplier.former_names ?? []) as string[];
  const displayName = formerNames.length > 0
    ? `${supplier.name} (Formerly ${formerNames[formerNames.length - 1]})`
    : (supplier.name as string);

  const approvedAdvances = (advances ?? [])
    .filter((a) => a.approval_status === "approved")
    .reduce((s, a) => s + Number(a.amount_naira), 0);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">{displayName}</h1>
        <Badge variant="blue">{(supplier.supplier_code as string | null) ?? "no code"}</Badge>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Profile</h2></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Phone: {(supplier.phone as string | null) ?? "—"}</div>
          <div>Registered: {formatTimestamp(supplier.created_at as string)}</div>
          {formerNames.length > 0 && <div>Previous names: {formerNames.join(", ")}</div>}
          {supplier.notes != null && <div>Notes: {supplier.notes as string}</div>}
          <div>Approved advances to date: <strong>{ngn(approvedAdvances)}</strong></div>
        </CardContent>
      </Card>

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
                      <div className="text-sm">
                        {site?.name ?? "—"} · {v.entry_path as string} · {formatTimestamp(v.created_at as string)}
                      </div>
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
                    <Badge variant={
                      a.approval_status === "approved" ? "green"
                        : a.approval_status === "rejected" ? "red" : "yellow"
                    }>
                      {a.approval_status as string}
                    </Badge>
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
    </main>
  );
}
