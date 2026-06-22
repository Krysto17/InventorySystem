import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { createStockLot, createLotSale, setLotSaleApproval } from "./actions";
import { formatTimestamp } from "@/lib/visits/format";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString()}`;

export default async function LotSalesPage() {
  const me = await getProfile();
  const supabase = await createClient();
  const isOwner = me?.role === "owner";

  const { data: lots } = await supabase
    .from("stock_lots")
    .select("id, weight_kg, cost_price_per_kg, status, material:material_types(name), supplier:suppliers(name)")
    .eq("status", "available")
    .order("created_at", { ascending: true });

  const { data: materialTypes } = await supabase.from("material_types").select("id, name").order("name");
  const { data: suppliers } = await supabase.from("suppliers").select("id, name").order("name").limit(200);

  const { data: sales } = await supabase
    .from("lot_sales")
    .select(`
      id, buyer_name, approval_status, created_at,
      total_weight_kg, total_cost_price, avg_cost_price_per_kg,
      material:material_types(name),
      items:lot_sale_items(stock_lot:stock_lots(weight_kg, cost_price_per_kg, supplier:suppliers(name)))
    `)
    .order("created_at", { ascending: false })
    .limit(25);

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/inventory" className="text-sm text-gray-500 hover:underline">← Inventory</Link>
        <h1 className="text-2xl font-semibold">Lot-tracked bulk sales</h1>
      </div>

      {/* Register a stock lot */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">Register a stock lot</h2>
        <form action={createStockLot} className="grid grid-cols-2 gap-3 max-w-2xl sm:grid-cols-4 items-end">
          <label className="text-sm">Material
            <select name="material_type_id" required defaultValue="" className="mt-1 block w-full border rounded px-2 py-1 text-sm">
              <option value="" disabled>Select…</option>
              {(materialTypes ?? []).map((m) => <option key={m.id as string} value={m.id as string}>{m.name as string}</option>)}
            </select>
          </label>
          <label className="text-sm">Supplier
            <select name="supplier_id" defaultValue="" className="mt-1 block w-full border rounded px-2 py-1 text-sm">
              <option value="">—</option>
              {(suppliers ?? []).map((s) => <option key={s.id as string} value={s.id as string}>{s.name as string}</option>)}
            </select>
          </label>
          <label className="text-sm">Weight (kg)
            <input type="number" name="weight_kg" step="0.001" min="0" required className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
          </label>
          <label className="text-sm">Cost ₦/kg
            <input type="number" name="cost_price_per_kg" step="0.01" min="0" className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
          </label>
          <button type="submit" className="col-span-2 sm:col-span-4 px-4 py-2 bg-black text-white text-sm rounded">Add lot</button>
        </form>
      </section>

      {/* Create a sale from available lots */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">New bulk sale (select lots)</h2>
        {(lots?.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-600">No available lots. Register lots above first.</p>
        ) : (
          <form action={createLotSale} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <label className="text-sm">Buyer name
                <input type="text" name="buyer_name" required className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
              </label>
              <label className="text-sm">Buyer phone
                <input type="text" name="buyer_phone" className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
              </label>
            </div>
            <p className="text-xs text-gray-500">Select lots of the SAME material:</p>
            <div className="divide-y border rounded">
              {(lots ?? []).map((l) => {
                const mat = g1<{ name: string }>((l as { material: unknown }).material);
                const sup = g1<{ name: string }>((l as { supplier: unknown }).supplier);
                const w = Number(l.weight_kg);
                const c = l.cost_price_per_kg != null ? Number(l.cost_price_per_kg) : 0;
                return (
                  <label key={l.id as string} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                    <input type="checkbox" name="lot_ids" value={l.id as string} />
                    <span className="flex-1">
                      <span className="font-medium">{mat?.name ?? "—"}</span> · {sup?.name ?? "no supplier"}
                    </span>
                    <span className="text-gray-500">{w.toFixed(3)} kg · {ngn(c)}/kg · {ngn(w * c)}</span>
                  </label>
                );
              })}
            </div>
            <button type="submit" className="px-4 py-2 bg-black text-white text-sm rounded">Create pending sale</button>
          </form>
        )}
      </section>

      {/* Existing sales */}
      <section>
        <h2 className="font-semibold mb-2">Bulk sales ({sales?.length ?? 0})</h2>
        <div className="space-y-3">
          {(sales ?? []).map((s) => {
            const mat = g1<{ name: string }>((s as { material: unknown }).material);
            const items = ((s as { items: unknown[] }).items ?? []);
            const status = s.approval_status as string;
            const badge = status === "approved" ? "bg-green-100 text-green-800"
              : status === "rejected" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800";
            return (
              <div key={s.id as string} className="border rounded p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{s.buyer_name as string}</span>
                    <span className="text-sm text-gray-500"> · {mat?.name ?? "—"} · {formatTimestamp(s.created_at as string)}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${badge}`}>{status}</span>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-sm mt-3">
                  <thead className="text-left text-xs text-gray-500">
                    <tr><th className="py-1">Supplier</th><th className="py-1 text-right">Weight (kg)</th><th className="py-1 text-right">Price ₦</th><th className="py-1 text-right">Total ₦</th></tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const lot = g1<{ weight_kg: number; cost_price_per_kg: number | null; supplier: unknown }>((it as { stock_lot: unknown }).stock_lot);
                      const w = Number(lot?.weight_kg ?? 0);
                      const c = lot?.cost_price_per_kg != null ? Number(lot.cost_price_per_kg) : 0;
                      const sup = g1<{ name: string }>(lot?.supplier ?? null);
                      return (
                        <tr key={i} className="border-t">
                          <td className="py-1">{sup?.name ?? "—"}</td>
                          <td className="py-1 text-right">{w.toFixed(3)}</td>
                          <td className="py-1 text-right">{ngn(c)}</td>
                          <td className="py-1 text-right">{ngn(w * c)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                {s.avg_cost_price_per_kg != null && (
                  <div className="mt-2 text-sm">
                    Avg cost: <strong>{ngn(Number(s.avg_cost_price_per_kg))}/kg</strong>{" "}
                    ({ngn(Number(s.total_cost_price))} ÷ {Number(s.total_weight_kg).toFixed(3)} kg)
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <a href={`/api/pdf/lot-sale/${s.id}`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 border rounded hover:bg-gray-50">
                    Download breakdown PDF
                  </a>
                  {isOwner && status === "pending" && (
                    <>
                      <form action={setLotSaleApproval}>
                        <input type="hidden" name="lot_sale_id" value={s.id as string} />
                        <input type="hidden" name="decision" value="approved" />
                        <button type="submit" className="text-xs px-3 py-1 bg-green-700 text-white rounded">Approve</button>
                      </form>
                      <form action={setLotSaleApproval}>
                        <input type="hidden" name="lot_sale_id" value={s.id as string} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button type="submit" className="text-xs px-3 py-1 border rounded">Reject</button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
