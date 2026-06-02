import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatWeight, formatTimestamp } from "@/lib/visits/format";

export default async function InventoryPage() {
  const supabase = await createClient();

  // Visits awaiting stock intake
  const { data: intakeQueue } = await supabase
    .from("visits")
    .select(`
      id, created_at,
      supplier:suppliers(name),
      declared_material_type:material_types(name),
      analysis:analysis_records(weight, grade)
    `)
    .eq("state", "awaiting_stock_intake")
    .order("created_at", { ascending: true });

  // Current stock balance grouped by material_type + grade
  const { data: movements } = await supabase
    .from("stock_movements")
    .select("material_type_id, grade, weight, direction, material_type:material_types(name)");

  // Aggregate in JS: group by (material_type_id, grade) → sum in/out
  type StockRow = { material_type_id: string; material_name: string; grade: string | null; balance: number };
  const stockMap = new Map<string, StockRow>();
  for (const m of movements ?? []) {
    const mt = (m as { material_type: { name?: string } | { name?: string }[] | null }).material_type;
    const materialName =
      (Array.isArray(mt) ? mt[0]?.name : (mt as { name?: string } | null)?.name) ?? "—";
    const key = `${m.material_type_id}::${m.grade ?? ""}`;
    const existing = stockMap.get(key);
    const delta = (m.direction === "in" ? 1 : -1) * Number(m.weight);
    if (existing) {
      existing.balance += delta;
    } else {
      stockMap.set(key, {
        material_type_id: m.material_type_id as string,
        material_name: materialName,
        grade: m.grade as string | null,
        balance: delta,
      });
    }
  }
  const stockRows = Array.from(stockMap.values()).filter((r) => r.balance > 0);

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Inventory Manager</h1>
      </header>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link href="/inventory/bulk-sales" className="px-3 py-2 border rounded">
          Bulk sales
        </Link>
        <Link href="/inventory/consumables" className="px-3 py-2 border rounded">
          Consumables
        </Link>
      </nav>

      <section>
        <h2 className="font-semibold mb-2">
          Awaiting intake ({intakeQueue?.length ?? 0})
        </h2>
        {!intakeQueue || intakeQueue.length === 0 ? (
          <p className="text-sm text-gray-600">No visits awaiting stock intake.</p>
        ) : (
          <ul className="border rounded divide-y">
            {intakeQueue.map((v) => {
              const sup = v.supplier as unknown as { name?: string } | null;
              const mat = v.declared_material_type as unknown as { name?: string } | null;
              const an = v.analysis as unknown as
                | { weight?: number; grade?: string | null }
                | { weight?: number; grade?: string | null }[]
                | null;
              const analysis = Array.isArray(an) ? an[0] : an;
              return (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-medium">{sup?.name ?? "—"}</div>
                        <div className="text-sm text-gray-600">
                          {mat?.name ?? "—"}
                          {analysis?.grade ? ` · Grade ${analysis.grade}` : ""}
                          {analysis?.weight ? ` · ${formatWeight(analysis.weight)}` : ""}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">{formatTimestamp(v.created_at)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Current stock</h2>
        {stockRows.length === 0 ? (
          <p className="text-sm text-gray-600">No stock on hand.</p>
        ) : (
          <table className="w-full text-sm border rounded">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-left px-3 py-2">Grade</th>
                <th className="text-right px-3 py-2">On hand</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stockRows.map((r) => (
                <tr key={`${r.material_type_id}::${r.grade ?? ""}`}>
                  <td className="px-3 py-2">{r.material_name}</td>
                  <td className="px-3 py-2">{r.grade ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatWeight(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
