import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTimestamp, formatNaira } from "@/lib/visits/format";

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
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Accounting — {visits?.length ?? 0} pending</h1>
      {!visits || visits.length === 0 ? (
        <p className="text-sm text-gray-600">Queue is empty.</p>
      ) : (
        <ul className="border rounded divide-y">
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
                <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                  <div className="flex justify-between">
                    <div>
                      <div className="font-medium">{sup?.name ?? "—"}</div>
                      <div className="text-sm text-gray-600">
                        {mat?.name ?? "—"} · {formatTimestamp(v.created_at)}
                      </div>
                    </div>
                    <div className="text-sm text-right">
                      <div>{formatNaira(pricing?.purchase_amount ?? null)}</div>
                      <div className="text-gray-500">{pricing?.payment_terms ?? "—"}</div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
