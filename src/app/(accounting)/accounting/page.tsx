import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTimestamp, formatNaira } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AccountingHomePage() {
  const supabase = await createClient();

  const { data: visits } = await supabase
    .from("visits")
    .select(`
      id, created_at, state, processing_deducted,
      supplier:suppliers(name, phone),
      declared_material_type:material_types(name),
      pricing:pricing(purchase_amount, payment_terms)
    `)
    .eq("state", "in_accounting")
    .order("created_at", { ascending: true });

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Accounting</h1>
        <p className="text-sm text-gray-500">{visits?.length ?? 0} visit{(visits?.length ?? 0) !== 1 ? "s" : ""} pending settlement</p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Queue</h2>
            <Badge variant="blue">{visits?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!visits || visits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">Queue is empty.</p>
          ) : (
            <ul className="divide-y">
              {visits.map((v) => {
                const sup = v.supplier as unknown as { name?: string } | null;
                const mat = v.declared_material_type as unknown as { name?: string } | null;
                const pr = v.pricing as unknown as
                  | { purchase_amount?: number; payment_terms?: string }
                  | { purchase_amount?: number; payment_terms?: string }[]
                  | null;
                const pricing = Array.isArray(pr) ? pr[0] : pr;
                return (
                  <li key={v.id}>
                    <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{sup?.name ?? "—"}</div>
                        <div className="text-xs text-gray-500">
                          {mat?.name ?? "—"} · {formatTimestamp(v.created_at)}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-medium">{formatNaira(pricing?.purchase_amount ?? null)}</div>
                        <div className="text-xs text-gray-500">{pricing?.payment_terms ?? "—"}</div>
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
