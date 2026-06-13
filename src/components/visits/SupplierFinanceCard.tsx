import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  recordDeduction, raisePaymentRequest, setPaymentStatus, uploadReceipt,
} from "@/app/visits/[id]/finance-actions";
import type { Role } from "@/lib/auth/roles";

const ngn = (n: number) => `₦${n.toLocaleString()}`;

const STATUS_VARIANT: Record<string, "default" | "green" | "yellow" | "red" | "blue" | "purple"> = {
  pending: "yellow", approved: "blue", paid: "green", partially_paid: "purple", rejected: "red",
};

export async function SupplierFinanceCard({
  visitId,
  supplierId,
  viewerRole,
}: {
  visitId: string;
  supplierId: string | null;
  viewerRole: Role;
}) {
  // Finance workflow concerns manager / accounting / owner only.
  if (!["manager", "accounting", "owner"].includes(viewerRole)) return null;
  if (!supplierId) return null;

  const supabase = await createClient();

  const [{ data: debtRaw }, { data: payments }, { data: deductions }] = await Promise.all([
    supabase.rpc("supplier_outstanding_debt", { _supplier_id: supplierId }),
    supabase
      .from("payments")
      .select("id, direction, amount, status, status_note, receipt_path, paid_at")
      .eq("visit_id", visitId)
      .order("created_at", { ascending: true }),
    supabase
      .from("advance_deductions")
      .select("id, amount, notes, created_at")
      .eq("ref_visit_id", visitId)
      .order("created_at", { ascending: true }),
  ]);

  const debt = Number(debtRaw ?? 0);
  const canDeduct = ["manager", "accounting", "owner"].includes(viewerRole);
  const canRequest = ["accounting", "owner"].includes(viewerRole);
  const isOwner = viewerRole === "owner";
  const isAccounting = viewerRole === "accounting";

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
        {/* Deductions recovered against this visit */}
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

        {/* Payment workflow */}
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">Payment workflow</h3>
          {(payments?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {(payments ?? []).map((p) => {
                const status = p.status as string;
                return (
                  <li key={p.id as string} className="space-y-1 py-2">
                    <div className="flex items-center justify-between">
                      <span>
                        {p.direction === "processing_fee_in" ? "Fee in" : "Payout"} · {ngn(Number(p.amount))}
                        {p.status_note != null && <span className="text-xs text-zinc-500"> · {p.status_note as string}</span>}
                      </span>
                      <Badge variant={STATUS_VARIANT[status] ?? "default"}>{status.replace("_", " ")}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isOwner && status === "pending" && (
                        <>
                          <form action={setPaymentStatus}>
                            <input type="hidden" name="visit_id" value={visitId} />
                            <input type="hidden" name="payment_id" value={p.id as string} />
                            <input type="hidden" name="status" value="approved" />
                            <button type="submit" className="rounded bg-green-700 px-2.5 py-0.5 text-xs text-white">Approve</button>
                          </form>
                          <form action={setPaymentStatus}>
                            <input type="hidden" name="visit_id" value={visitId} />
                            <input type="hidden" name="payment_id" value={p.id as string} />
                            <input type="hidden" name="status" value="rejected" />
                            <button type="submit" className="rounded border px-2.5 py-0.5 text-xs">Reject</button>
                          </form>
                        </>
                      )}
                      {(isAccounting || isOwner) && (status === "approved" || status === "partially_paid") && (
                        <>
                          <form action={setPaymentStatus}>
                            <input type="hidden" name="visit_id" value={visitId} />
                            <input type="hidden" name="payment_id" value={p.id as string} />
                            <input type="hidden" name="status" value="paid" />
                            <button type="submit" className="rounded bg-black px-2.5 py-0.5 text-xs text-white">Mark paid</button>
                          </form>
                          {status === "approved" && (
                            <form action={setPaymentStatus}>
                              <input type="hidden" name="visit_id" value={visitId} />
                              <input type="hidden" name="payment_id" value={p.id as string} />
                              <input type="hidden" name="status" value="partially_paid" />
                              <button type="submit" className="rounded border px-2.5 py-0.5 text-xs">Partially paid</button>
                            </form>
                          )}
                        </>
                      )}
                      {(isAccounting || isOwner) && (status === "paid" || status === "partially_paid") && !p.receipt_path && (
                        <form action={uploadReceipt} className="flex items-center gap-2">
                          <input type="hidden" name="visit_id" value={visitId} />
                          <input type="hidden" name="payment_id" value={p.id as string} />
                          <input type="file" name="receipt" accept="image/*,.pdf" required className="text-xs" />
                          <button type="submit" className="rounded border px-2.5 py-0.5 text-xs">Upload receipt</button>
                        </form>
                      )}
                      {p.receipt_path != null && (
                        <span className="text-xs text-zinc-500">Receipt on file ✓</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canRequest && (
          <form action={raisePaymentRequest} className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <input type="hidden" name="visit_id" value={visitId} />
            <label className="text-xs font-medium">
              Direction
              <select name="direction" defaultValue="purchase_amount_out" className="mt-1 block rounded border px-2 py-1 text-sm">
                <option value="purchase_amount_out">Payout to supplier</option>
                <option value="processing_fee_in">Fee from supplier</option>
              </select>
            </label>
            <label className="text-xs font-medium">
              Amount (₦)
              <input type="number" name="amount" min="0.01" step="0.01" required className="mt-1 block w-32 rounded border px-2 py-1 text-sm" />
            </label>
            <label className="flex-1 text-xs font-medium">
              Note
              <input type="text" name="notes" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="rounded bg-black px-3 py-1 text-sm text-white">
              Raise for owner approval
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
