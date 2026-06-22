import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatWeight, formatTimestamp } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";

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
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory Manager</h1>
          <p className="text-sm text-gray-500">{intakeQueue?.length ?? 0} visit{(intakeQueue?.length ?? 0) !== 1 ? "s" : ""} awaiting intake</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/inventory/bulk-sales" className="px-3 py-1.5 border rounded hover:bg-gray-100">Bulk sales</Link>
          <Link href="/inventory/consumables" className="px-3 py-1.5 border rounded hover:bg-gray-100">Consumables</Link>
        </nav>
      </header>

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Awaiting stock intake</h2>
            <Badge variant="blue">{intakeQueue?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!intakeQueue || intakeQueue.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No visits awaiting stock intake.</p>
          ) : (
            <ul className="divide-y">
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
                    <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{sup?.name ?? "—"}</div>
                        <div className="text-xs text-gray-500">
                          {mat?.name ?? "—"}
                          {analysis?.grade ? ` · Grade ${analysis.grade}` : ""}
                          {analysis?.weight ? ` · ${formatWeight(analysis.weight)}` : ""}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">{formatTimestamp(v.created_at)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-sm">Current stock (this site)</h2>
        </CardHeader>
        <CardContent className="p-0">
          {stockRows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No stock on hand.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-left px-4 py-2">Grade</th>
                  <th className="text-right px-4 py-2">On hand</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stockRows.map((r) => (
                  <tr key={`${r.material_type_id}::${r.grade ?? ""}`}>
                    <td className="px-4 py-2">{r.material_name}</td>
                    <td className="px-4 py-2 text-gray-600">{r.grade ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatWeight(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
