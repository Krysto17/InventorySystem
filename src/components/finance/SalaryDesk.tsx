import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { getSites } from "@/lib/reference";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/ActionForm";
import { formatNaira } from "@/lib/visits/format";
import { saveSalary, deleteSalary } from "@/lib/finance/salary-actions";
import { one as g1 } from "@/lib/db/relation";

const monthLabel = (period: string) =>
  new Date(`${period}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/**
 * Where the payroll total for a month is entered.
 *
 * The business already has a "Wages" expense category, but an expense is one
 * itemised purchase needing the owner's approval, and payroll is a single
 * figure the accountant simply knows. This records that figure, one per site
 * per month — the database refuses a second, so a month cannot be entered
 * twice and quietly double the cost on the statement.
 */
export async function SalaryDesk({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  const me = await getProfile();
  const supabase = await createClient();
  const isOwner = me?.role === "owner";

  const [{ data: rows }, sites] = await Promise.all([
    supabase.from("salary_entries")
      .select("id, site_id, period, amount_naira, note, created_at, site:sites(name), by:profiles!salary_entries_recorded_by_fkey(full_name)")
      .order("period", { ascending: false })
      .limit(36),
    isOwner ? getSites() : Promise.resolve([]),
  ]);

  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <a href={backHref} className="text-sm text-gray-500 hover:underline">← {backLabel}</a>
        <h1 className="text-2xl font-bold">Salaries</h1>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Enter a month&rsquo;s payroll</h2>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveSalary} className="flex flex-wrap items-end gap-3 text-sm"
            successText="Saved.">
            {isOwner && (
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-ink-2">Site</span>
                <select name="site_id" required className="rounded border border-line px-2 py-1.5">
                  {sites.map((s) => (
                    <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-ink-2">Month</span>
              <input type="month" name="month" defaultValue={thisMonth} required
                className="rounded border border-line px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-ink-2">Total salary (₦)</span>
              <input type="text" inputMode="decimal" name="amount_naira" required
                placeholder="2400000" className="rounded border border-line px-2 py-1.5" />
            </label>
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-ink-2">Note (optional)</span>
              <input type="text" name="note" className="rounded border border-line px-2 py-1.5" />
            </label>
            <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
              Save
            </button>
          </ActionForm>
          <p className="mt-2 text-xs text-ink-2">
            One figure per site per month. Entering a month again corrects it rather than adding a
            second line. The profit-and-loss statement reads salary from here and ignores the
            Wages expense category, so the same money is never counted twice.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Entered so far</h2></CardHeader>
        <CardContent className="p-0">
          {(rows ?? []).length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No salary figures entered yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(rows ?? []).map((r) => (
                <li key={r.id as string} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{monthLabel(r.period as string)}</span>
                    <span className="text-ink-2">
                      {" · "}{g1<{ name: string }>((r as { site: unknown }).site)?.name ?? "—"}
                    </span>
                    {r.note ? <span className="block text-xs text-ink-2">{r.note as string}</span> : null}
                    <span className="block text-xs text-ink-2">
                      Entered by {g1<{ full_name: string }>((r as { by: unknown }).by)?.full_name ?? "—"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{formatNaira(Number(r.amount_naira))}</span>
                    {isOwner && (
                      <ActionForm action={deleteSalary} data-confirm="Remove this salary figure?">
                        <input type="hidden" name="id" value={r.id as string} />
                        <button type="submit" className="text-xs text-reject hover:underline">Remove</button>
                      </ActionForm>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
