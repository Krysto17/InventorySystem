import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getProfile } from "@/lib/auth/get-profile";
import { reviewExpense, deleteConsumable } from "./actions";
import { CATEGORY_LABELS } from "./categories";
import { ConsumableForm } from "@/components/consumables/ConsumableForm";
import { ConsumableEditForm } from "@/components/consumables/ConsumableEditForm";
import { fetchKnownAccounts } from "@/lib/accounts/known-accounts";
import { formatTimestamp } from "@/lib/visits/format";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export default async function ConsumablesPage() {
  const me = await getProfile();
  const isOwner = me?.role === "owner";
  const canDelete = isOwner || me?.role === "manager"; // before payment
  const supabase = await createClient();
  const accounts = await fetchKnownAccounts();

  const { data: consumables } = await supabase
    .from("consumables")
    .select(`
      id, name, category, entry_date, comment, created_at, amount_naira, approval_status,
      account_name, account_number, bank_name,
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
        <ConsumableForm today={today} accounts={accounts} />
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
                        <span className="inline-flex items-center gap-2">
                          <span>{recName} · {formatTimestamp(c.created_at as string)}</span>
                          {canDelete && status !== "paid" && (
                            <>
                              <ConsumableEditForm
                                accounts={accounts}
                                id={c.id as string}
                                name={c.name as string}
                                category={c.category as string}
                                amount={c.amount_naira != null ? Number(c.amount_naira) : null}
                                comment={(c.comment as string | null) ?? null}
                                accountName={(c.account_name as string | null) ?? null}
                                accountNumber={(c.account_number as string | null) ?? null}
                                bankName={(c.bank_name as string | null) ?? null}
                              />
                              <form action={deleteConsumable} className="inline">
                                <input type="hidden" name="consumable_id" value={c.id as string} />
                                <button type="submit" title="Delete this expense (before payment)"
                                  className="rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-50">
                                  Delete
                                </button>
                              </form>
                            </>
                          )}
                        </span>
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
