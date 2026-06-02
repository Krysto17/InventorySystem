import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { createBulkSale } from "./actions";
import { formatNaira, formatWeight, formatTimestamp } from "@/lib/visits/format";

export default async function BulkSalesPage() {
  const supabase = await createClient();

  const { data: sales } = await supabase
    .from("bulk_sales")
    .select(`
      id, buyer_name, buyer_phone, grade, weight, unit_price, total,
      sold_at, approval_status, approved_at, rejection_note, received_amount,
      material_type:material_types(name),
      recorded_by_profile:profiles!bulk_sales_recorded_by_fkey(full_name),
      approved_by_profile:profiles!bulk_sales_approved_by_fkey(full_name)
    `)
    .order("created_at", { ascending: false });

  const { data: materialTypes } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("active", true)
    .order("name");

  const statusBadge = (s: string) => {
    if (s === "approved") return "bg-green-100 text-green-800";
    if (s === "rejected") return "bg-red-100 text-red-800";
    return "bg-yellow-100 text-yellow-800";
  };

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/inventory" className="text-sm text-gray-500 hover:underline">
          ← Inventory
        </Link>
        <h1 className="text-2xl font-semibold">Bulk Sales</h1>
      </div>

      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">New bulk sale</h2>
        <form action={createBulkSale} className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm font-medium">
              Buyer name *
              <input
                type="text"
                name="buyer_name"
                required
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">
              Buyer phone
              <input
                type="text"
                name="buyer_phone"
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">
              Material type *
              <select
                name="material_type_id"
                required
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              >
                <option value="">Select material…</option>
                {(materialTypes ?? []).map((m) => (
                  <option key={m.id as string} value={m.id as string}>
                    {m.name as string}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">
              Grade
              <input
                type="text"
                name="grade"
                placeholder="e.g. A, B+, 65% pure"
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Weight (kg) *
              <input
                type="number"
                name="weight"
                step="0.001"
                min="0.001"
                required
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-sm font-medium">
              Unit price (₦/kg) *
              <input
                type="number"
                name="unit_price"
                step="0.01"
                min="0.01"
                required
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-black text-white text-sm rounded"
          >
            Submit for owner approval
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Sales history ({sales?.length ?? 0})</h2>
        {!sales || sales.length === 0 ? (
          <p className="text-sm text-gray-600">No bulk sales yet.</p>
        ) : (
          <ul className="border rounded divide-y">
            {sales.map((s) => {
              const mat = s.material_type as unknown as { name?: string } | null;
              const rec = (s as { recorded_by_profile: unknown }).recorded_by_profile;
              const recName = (Array.isArray(rec) ? rec[0]?.full_name : (rec as { full_name?: string } | null)?.full_name) ?? "—";
              return (
                <li key={s.id as string} className="px-3 py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">
                        {s.buyer_name as string}
                        {s.buyer_phone ? (
                          <span className="text-gray-500 font-normal"> · {s.buyer_phone}</span>
                        ) : null}
                      </div>
                      <div className="text-sm text-gray-600">
                        {mat?.name ?? "—"}
                        {s.grade ? ` · ${s.grade}` : ""}
                        {" "}· {formatWeight(Number(s.weight))} ×{" "}
                        {formatNaira(Number(s.unit_price))} ={" "}
                        <strong>{formatNaira(Number(s.total))}</strong>
                      </div>
                      {s.rejection_note && (
                        <div className="text-sm text-red-600 mt-1">
                          Rejected: {s.rejection_note as string}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        Submitted by {recName} · {formatTimestamp(s.sold_at as string)}
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded ${statusBadge(s.approval_status as string)}`}
                    >
                      {s.approval_status as string}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
