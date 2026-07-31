import { createClient } from "@/lib/supabase/server";
import { addPayoutSplit, removePayoutSplit } from "@/app/visits/[id]/finance-actions";
import { PayoutSplitForm } from "@/components/visits/PayoutSplitForm";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { fetchKnownAccounts } from "@/lib/accounts/known-accounts";
import { one as g1 } from "@/lib/db/relation";
import type { Role } from "@/lib/auth/roles";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// The manager plans exactly how much of a payout goes to each account; the
// accountant pays against this plan. Finance roles all see it.
export async function PayoutSplitPlan({
  visitId, net, viewerRole,
}: {
  visitId: string; net: number; viewerRole: Role;
}) {
  if (!["manager", "accounting", "owner"].includes(viewerRole)) return null;

  const supabase = await createClient();
  const [{ data: splits }, accounts, { data: visitRow }] = await Promise.all([
    supabase.from("settlement_payout_splits")
      .select("id, amount, account_name, account_number, bank_name, note")
      .eq("visit_id", visitId).order("created_at", { ascending: true }),
    fetchKnownAccounts(),
    // Whatever isn't allocated goes to the supplier's own account.
    supabase.from("visits")
      .select("supplier:suppliers(name, account_name, account_number, bank_name)")
      .eq("id", visitId).maybeSingle(),
  ]);
  const supplier = g1<{ name: string; account_name: string | null; account_number: string | null; bank_name: string | null }>(
    (visitRow as { supplier: unknown } | null)?.supplier,
  );

  const rows = splits ?? [];
  const planned = rows.reduce((s, r) => s + Number(r.amount), 0);
  const unplanned = net - planned;
  const canPlan = viewerRole === "manager" || viewerRole === "owner";
  if (!canPlan && rows.length === 0) return null; // nothing to show the accountant

  return (
    <div className="border-t border-line pt-3">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-2">
        <span>Payout split — pay these exact amounts</span>
        <span>{ngn(planned)} split{unplanned > 0.005 ? ` · ${ngn(unplanned)} to the supplier` : ""}</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-ink-2">No split planned — pay the full {ngn(net)} to the supplier&rsquo;s account.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id as string} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-medium">{r.account_name as string}</span>
                <span className="block text-xs text-ink-2">
                  <span className="mono">{r.account_number as string}</span> · {r.bank_name as string}
                  {r.note ? ` · ${r.note as string}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-semibold">{ngn(Number(r.amount))}</span>
                {canPlan && (
                  <form action={removePayoutSplit} data-confirm="Remove this split from the plan?">
                    <input type="hidden" name="visit_id" value={visitId} />
                    <input type="hidden" name="split_id" value={r.id as string} />
                    <SubmitButton pendingText="…" className="rounded border border-reject px-1.5 text-[11px] leading-5 text-reject hover:bg-reject-soft disabled:opacity-50">✕</SubmitButton>
                  </form>
                )}
              </span>
            </li>
          ))}
          {/* Whatever wasn't split out is paid to the supplier's own account. */}
          {unplanned > 0.005 && (
            <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-medium">{supplier?.name ?? "Supplier"} <span className="text-ink-2">(own account)</span></span>
                <span className="block text-xs text-ink-2">
                  {supplier?.account_number
                    ? <>{supplier.account_name ?? "—"} · <span className="mono">{supplier.account_number}</span> · {supplier.bank_name ?? "—"}</>
                    : "No account details on file"}
                </span>
              </span>
              <span className="font-semibold">{ngn(unplanned)}</span>
            </li>
          )}
        </ul>
      )}

      {canPlan && unplanned > 0.005 && (
        <PayoutSplitForm
          visitId={visitId}
          unplanned={unplanned}
          accounts={accounts}
          action={addPayoutSplit}
        />
      )}
    </div>
  );
}
