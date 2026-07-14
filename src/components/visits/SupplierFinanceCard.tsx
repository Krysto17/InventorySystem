import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { recordDeduction } from "@/app/visits/[id]/finance-actions";
import type { Role } from "@/lib/auth/roles";

const ngn = (n: number) => `₦${n.toLocaleString()}`;

// Supplier finance on the visit: outstanding advance debt + the deductions
// recovered against this batch. (Actual payouts run through the batch settlement,
// not a separate payments ledger.)
export async function SupplierFinanceCard({
  visitId,
  supplierId,
  viewerRole,
}: {
  visitId: string;
  supplierId: string | null;
  viewerRole: Role;
}) {
  if (!["manager", "accounting", "owner"].includes(viewerRole)) return null;
  if (!supplierId) return null;

  const supabase = await createClient();
  const [{ data: debtRaw }, { data: deductions }] = await Promise.all([
    supabase.rpc("supplier_outstanding_debt", { _supplier_id: supplierId }),
    supabase
      .from("advance_deductions")
      .select("id, amount, notes, created_at")
      .eq("ref_visit_id", visitId)
      .order("created_at", { ascending: true }),
  ]);

  const debt = Number(debtRaw ?? 0);
  const canDeduct = ["manager", "accounting", "owner"].includes(viewerRole);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Supplier finance</h2>
          <Badge variant={debt > 0 ? "red" : "green"}>
            {debt > 0 ? `Outstanding debt ${ngn(debt)}` : "No outstanding debt"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(deductions?.length ?? 0) > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-zinc-500">Deductions on this visit</h3>
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {(deductions ?? []).map((d) => (
                <li key={d.id as string} className="flex items-center justify-between py-1.5">
                  <span className="text-zinc-600 dark:text-zinc-300">{(d.notes as string | null) ?? "Advance recovery"}</span>
                  <span className="font-medium">−{ngn(Number(d.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canDeduct && debt > 0 && (
          <form action={recordDeduction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="visit_id" value={visitId} />
            <input type="hidden" name="supplier_id" value={supplierId} />
            <label className="text-xs font-medium">
              Deduct from payout (₦)
              <input type="number" name="amount" min="0.01" max={debt} step="0.01" required className="mt-1 block w-36 rounded border px-2 py-1 text-sm" />
            </label>
            <label className="flex-1 text-xs font-medium">
              Note
              <input type="text" name="notes" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-zinc-50">Record deduction</button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
