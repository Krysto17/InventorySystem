import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getProfile } from "@/lib/auth/get-profile";
import { createConsumable, reviewExpense } from "./actions";
import { CONSUMABLE_CATEGORIES, CATEGORY_LABELS } from "./categories";
import { formatTimestamp } from "@/lib/visits/format";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export default async function ConsumablesPage() {
  const me = await getProfile();
  const isOwner = me?.role === "owner";
  const supabase = await createClient();

  const { data: consumables } = await supabase
    .from("consumables")
    .select(`
      id, name, category, entry_date, comment, created_at, amount_naira, approval_status,
      recorded_by_profile:profiles!consumables_recorded_by_fkey(full_name)
    `)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/inventory" className="text-sm text-gray-500 hover:underline">
          ← Inventory
        </Link>
        <h1 className="text-2xl font-semibold">Consumables</h1>
      </div>

      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">Log a consumable</h2>
        <form action={createConsumable} className="space-y-3 max-w-md">
          <label className="block text-sm font-medium">
            Name *
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. Diesel, Generator repair, Office paper"
              className="mt-1 block w-full border rounded px-2 py-1 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Category *
              <select
                name="category"
                required
                defaultValue=""
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              >
                <option value="" disabled>Select…</option>
                {CONSUMABLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Date
              <input
                type="date"
                name="entry_date"
                defaultValue={today}
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Amount (₦, optional)
            <input
              type="number"
              name="amount_naira"
              min="0.01"
              step="0.01"
              className="mt-1 block w-full border rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm font-medium">
            Comment
            <textarea
              name="comment"
              rows={2}
              placeholder="Optional note"
              className="mt-1 block w-full border rounded px-2 py-1 text-sm"
            />
          </label>
          <button type="submit" className="px-4 py-2 bg-black text-white text-sm rounded">
            Log
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-2">
          Logged consumables ({consumables?.length ?? 0})
        </h2>
        {!consumables || consumables.length === 0 ? (
          <p className="text-sm text-gray-600">No consumables logged yet.</p>
        ) : (
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Comment</th>
                  <th className="px-3 py-2">Logged by</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {consumables.map((c) => {
                  const rec = (c as { recorded_by_profile: unknown }).recorded_by_profile;
                  const recName =
                    (Array.isArray(rec)
                      ? (rec[0] as { full_name?: string })?.full_name
                      : (rec as { full_name?: string } | null)?.full_name) ?? "—";
                  const category = c.category as keyof typeof CATEGORY_LABELS;
                  const status = c.approval_status as string;
                  return (
                    <tr key={c.id as string} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">{c.entry_date as string}</td>
                      <td className="px-3 py-2 font-medium">{c.name as string}</td>
                      <td className="px-3 py-2">{CATEGORY_LABELS[category] ?? category}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {c.amount_naira != null ? `₦${Number(c.amount_naira).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[status] ?? ""}`}>
                          {status}
                        </span>
                        {isOwner && status === "pending" && (
                          <span className="ml-2 inline-flex gap-1">
                            <form action={reviewExpense} className="inline">
                              <input type="hidden" name="consumable_id" value={c.id as string} />
                              <input type="hidden" name="decision" value="approved" />
                              <button type="submit" className="rounded bg-green-700 px-1.5 py-0.5 text-[10px] text-white">✓</button>
                            </form>
                            <form action={reviewExpense} className="inline">
                              <input type="hidden" name="consumable_id" value={c.id as string} />
                              <input type="hidden" name="decision" value="rejected" />
                              <button type="submit" className="rounded border px-1.5 py-0.5 text-[10px]">✗</button>
                            </form>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{(c.comment as string | null) ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {recName} · {formatTimestamp(c.created_at as string)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
