import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getProfile } from "@/lib/auth/get-profile";
import { reviewExpense, deleteConsumable } from "./actions";
import { CATEGORY_LABELS } from "./categories";
import { ConsumableForm } from "@/components/consumables/ConsumableForm";
import { ConsumableEditForm } from "@/components/consumables/ConsumableEditForm";
import { fetchKnownAccounts } from "@/lib/accounts/known-accounts";
import { formatTimestamp } from "@/lib/visits/format";
import { ListControls } from "@/components/ui/ListControls";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "on_hold", label: "On hold" },
  { value: "rejected", label: "Rejected" },
];

export default async function ConsumablesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = String(params.q ?? "").trim();
  const status = String(params.status ?? "");
  const me = await getProfile();
  const isOwner = me?.role === "owner";
  const isInventory = me?.role === "inventory";
  const supabase = await createClient();
  const accounts = await fetchKnownAccounts();

  // The inventory officer keeps expenses for every site, so they pick the site
  // an expense belongs to and see all of them here.
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");
  const siteOptions = (sites ?? []).map((s) => ({ id: s.id as string, name: s.name as string }));
  const siteName = new Map(siteOptions.map((s) => [s.id, s.name]));

  // Searched and filtered in Postgres so the whole expense log stays reachable,
  // not just the newest page of it.
  let expenseQuery = supabase
    .from("consumables")
    .select(`
      id, name, category, entry_date, comment, created_at, amount_naira, approval_status, site_id,
      account_name, account_number, bank_name,
      recorded_by_profile:profiles!consumables_recorded_by_fkey(full_name)
    `)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) expenseQuery = expenseQuery.eq("approval_status", status);
  if (q) {
    const safe = q.replace(/[,()*%]/g, "");
    expenseQuery = expenseQuery.or(
      `name.ilike.%${safe}%,comment.ilike.%${safe}%,category.ilike.%${safe}%,account_name.ilike.%${safe}%`,
    );
  }
  const [{ data: consumables }, { data: totalsRows }] = await Promise.all([
    expenseQuery,
    // Totals cover every matching expense, not just the page of them below.
    supabase.rpc("expense_totals", { p_status: status || undefined, p_q: q || undefined }),
  ]);
  const totals = (totalsRows ?? [])[0] as {
    entries: number; total_naira: number; pending_naira: number;
    approved_naira: number; paid_naira: number;
  } | undefined;
  const ngn = (n: number) => `₦${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

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
        <ConsumableForm today={today} accounts={accounts}
          sites={isInventory || isOwner ? siteOptions : []}
          defaultSiteId={(me?.site_id as string | null) ?? null} />
      </section>

      <section>
        <h2 className="font-semibold mb-2">
          Logged consumables ({consumables?.length ?? 0})
        </h2>
        {totals && (
          <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded border bg-gray-200 sm:grid-cols-4 dark:bg-zinc-800">
            {[
              ["Total recorded", ngn(totals.total_naira), `${totals.entries} ${Number(totals.entries) === 1 ? "entry" : "entries"}`],
              ["Awaiting approval", ngn(totals.pending_naira), ""],
              ["Approved, unpaid", ngn(totals.approved_naira), ""],
              ["Paid", ngn(totals.paid_naira), ""],
            ].map(([label, value, sub]) => (
              <div key={label} className="bg-white px-3 py-2 dark:bg-zinc-900">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
                <div className="mono text-base font-semibold">{value}</div>
                {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="border rounded">
          <ListControls
            basePath="/inventory/consumables"
            query={q}
            status={status}
            options={STATUS_OPTIONS}
            placeholder="Search name, category, note…"
          />
        {!consumables || consumables.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-600">
            {q || status ? "No expenses match that search." : "No consumables logged yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Paid to</th>
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
                  // Inventory corrects its own entries until the owner rules on
                  // them; manager/owner can still fix one right up to payment.
                  const canAmend = isOwner || me?.role === "manager" || (isInventory && status === "pending");
                  return (
                    <tr key={c.id as string} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">{c.entry_date as string}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{siteName.get(c.site_id as string) ?? "—"}</td>
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
                      <td className="px-3 py-2 text-gray-600">
                        {c.account_number ? (
                          <>
                            <span className="block">{(c.account_name as string | null) ?? "—"}</span>
                            <span className="mono block text-xs text-gray-500">
                              {c.account_number as string} · {(c.bank_name as string | null) ?? "—"}
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{(c.comment as string | null) ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>{recName} · {formatTimestamp(c.created_at as string)}</span>
                          {canAmend && status !== "paid" && (
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
        </div>
      </section>
    </main>
  );
}
