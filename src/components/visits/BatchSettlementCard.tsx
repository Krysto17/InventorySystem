import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { recordDeduction, removeDeduction, removeUtilityCharge } from "@/app/visits/[id]/finance-actions";
import { updateSupplierAccount } from "@/app/visits/[id]/settlement-actions";
import { AccountFields } from "@/components/accounts/AccountFields";
import { fetchKnownAccounts } from "@/lib/accounts/known-accounts";
import { RecordPaymentForm } from "@/components/visits/RecordPaymentForm";
import { CloseSettlementButton } from "@/components/visits/CloseSettlementButton";
import { formatTimestamp } from "@/lib/visits/format";
import type { Role } from "@/lib/auth/roles";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const STATUS_VARIANT: Record<string, "default" | "green" | "yellow" | "red" | "blue" | "paid"> = {
  pending: "yellow", approved: "blue", on_hold: "yellow", partially_paid: "blue", paid: "paid", rejected: "red",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "pending", approved: "approved", on_hold: "on hold",
  partially_paid: "part-paid", paid: "paid", rejected: "rejected",
};
const METHOD_LABEL: Record<string, string> = { cash: "Cash", transfer: "Bank transfer", other: "Other" };

// One consolidated batch-supply settlement: all materials (kg + price),
// the light bill (processing fee), advance deducted, remaining debt, and the
// net balance — assembled by the manager, approved by the owner, paid by the
// accountant. Finance figures are visible to manager / accounting / owner only.
export async function BatchSettlementCard({
  visitId,
  supplierId,
  viewerRole,
}: {
  visitId: string;
  supplierId: string | null;
  viewerRole: Role;
}) {
  if (!["manager", "accounting", "owner"].includes(viewerRole) || !supplierId) return null;

  const supabase = await createClient();
  const [{ data: lines }, { data: charges }, { data: deds }, { data: debt }, { data: settlement }, { data: totals }] =
    await Promise.all([
      supabase.from("visit_materials")
        .select("id, weight_kg, unit_price, purchase_amount, material:material_types(name)")
        .eq("visit_id", visitId).order("created_at", { ascending: true }),
      supabase.from("utility_charges").select("id, kind, description, amount").eq("visit_id", visitId),
      supabase.from("advance_deductions").select("id, amount, notes, created_at").eq("ref_visit_id", visitId),
      supabase.rpc("supplier_outstanding_debt", { _supplier_id: supplierId }),
      supabase.from("batch_settlements").select("*").eq("visit_id", visitId).maybeSingle(),
      supabase.rpc("settlement_totals", { p_visit_id: visitId }),
    ]);

  const { data: supplier } = await supabase
    .from("suppliers").select("account_name, account_number, bank_name").eq("id", supplierId).maybeSingle();
  const knownAccounts = await fetchKnownAccounts();

  // Payment ledger against this settlement (part / full; cash by manager, etc.).
  const settlementId = (settlement?.id as string | undefined) ?? null;
  const { data: payments } = settlementId
    ? await supabase.from("settlement_payments")
        .select("id, amount, method, note, created_at, payer:profiles!settlement_payments_paid_by_fkey(full_name)")
        .eq("settlement_id", settlementId).order("created_at", { ascending: true })
    : { data: null };

  // Totals come from a single source: the stored snapshot once a settlement
  // exists (authoritative + reconciles), otherwise the live settlement_totals
  // function. "other" charges stay itemised here for the per-line remove button.
  const otherCharges = (charges ?? []).filter((c) => c.kind === "other");
  const t = (totals ?? [])[0] as { materials: number; processing_fee: number; other_deductions: number; advances: number; net: number } | undefined;
  const snap = settlement as Record<string, unknown> | null;
  const materials = snap ? Number(snap.materials_total) : Number(t?.materials ?? 0);
  const lightBill = snap ? Number(snap.light_bill_total) : Number(t?.processing_fee ?? 0);
  const otherTotal = snap ? Number(snap.other_deductions_total) : Number(t?.other_deductions ?? 0);
  const advance = snap ? Number(snap.advance_deducted) : Number(t?.advances ?? 0);
  const net = snap ? Number(snap.net_balance) : Number(t?.net ?? 0);
  const outstandingDebt = Number(debt ?? 0);

  const isManager = viewerRole === "manager";
  const isOwner = viewerRole === "owner";
  const isAccounting = viewerRole === "accounting";
  const status = (settlement?.status as string | undefined) ?? null;
  // Deductions/edits lock once the batch is out of the manager's hands.
  const locked = status != null && status !== "pending" && status !== "rejected";
  const paidTotal = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(net - paidTotal, 0);
  // A payment can be recorded while the settlement is open (approved or part-paid
  // and not on hold) — cash usually by the manager, transfers by the accountant.
  const settlementOpen = status === "approved" || status === "partially_paid";
  const canRecordPayment = (isManager || isAccounting || isOwner) && settlementOpen && remaining > 0.005;
  // Fully-covered (₦0 left) — close it directly instead of recording a payment.
  const canCloseZero = (isManager || isAccounting || isOwner) && settlementOpen && remaining <= 0.005;
  // Manager/owner may remove an applied deduction (mistake) before the batch is
  // approved/paid.
  const canEditDeductions = (isManager || isOwner) && !locked;

  // Supply invoice (downloadable + WhatsApp-shareable) once the batch is submitted.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const invoiceUrl = `${origin}/api/pdf/supply-invoice/${visitId}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Batch supply settlement</h2>
          {status && <Badge variant={STATUS_VARIANT[status] ?? "default"}>{STATUS_LABEL[status] ?? status}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Materials */}
        <div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="py-1">Material</th>
                <th className="py-1 text-right">Weight (kg)</th>
                <th className="py-1 text-right">Price ₦/kg</th>
                <th className="py-1 text-right">Amount ₦</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => {
                const mat = g1<{ name: string }>((l as { material: unknown }).material);
                return (
                  <tr key={l.id as string} className="border-t border-line">
                    <td className="py-1">{mat?.name ?? "—"}</td>
                    <td className="py-1 text-right">{Number(l.weight_kg).toFixed(3)}</td>
                    <td className="py-1 text-right">{l.unit_price != null ? ngn(Number(l.unit_price)) : "—"}</td>
                    <td className="py-1 text-right">{l.purchase_amount != null ? ngn(Number(l.purchase_amount)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>

        {/* Breakdown */}
        <div className="space-y-1 border-t border-line pt-3 text-sm">
          <Row label="Materials total" value={ngn(materials)} />
          <Row label="Processing fee" value={`− ${ngn(lightBill)}`} />
          {otherCharges.map((c) => (
            <div key={c.id as string} className="flex items-center justify-between">
              <span className="text-ink-2">{(c.description as string | null)?.trim() || "Other deduction"}</span>
              <span className="flex items-center gap-2">
                − {ngn(Number(c.amount))}
                {canEditDeductions && (
                  <form action={removeUtilityCharge}>
                    <input type="hidden" name="visit_id" value={visitId} />
                    <input type="hidden" name="charge_id" value={c.id as string} />
                    <button type="submit" title="Remove this deduction" className="rounded border border-reject px-1.5 text-[11px] leading-4 text-reject hover:bg-reject-soft">✕</button>
                  </form>
                )}
              </span>
            </div>
          ))}
          {(deds ?? []).length === 0 ? (
            <Row label="Advance deducted" value={`− ${ngn(advance)}`} />
          ) : (
            (deds ?? []).map((d) => (
              <div key={d.id as string} className="flex items-center justify-between">
                <span className="text-ink-2">Advance deducted{(d.notes as string | null)?.trim() ? ` · ${(d.notes as string).trim()}` : ""}</span>
                <span className="flex items-center gap-2">
                  − {ngn(Number(d.amount))}
                  {canEditDeductions && (
                    <form action={removeDeduction}>
                      <input type="hidden" name="visit_id" value={visitId} />
                      <input type="hidden" name="deduction_id" value={d.id as string} />
                      <button type="submit" title="Remove this deduction" className="rounded border border-reject px-1.5 text-[11px] leading-4 text-reject hover:bg-reject-soft">✕</button>
                    </form>
                  )}
                </span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between border-t border-line pt-1 font-semibold">
            <span>Net balance payable</span><span>{ngn(net)}</span>
          </div>
          <Row
            label="Remaining advance debt"
            value={outstandingDebt > 0 ? ngn(outstandingDebt) : "₦0 (cleared)"}
          />
        </div>

        {/* Manager: deduct an advance against this batch (partial or full) */}
        {isManager && !locked && outstandingDebt > 0 && (
          <form action={recordDeduction} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <input type="hidden" name="visit_id" value={visitId} />
            <input type="hidden" name="supplier_id" value={supplierId} />
            <label className="text-xs font-medium">
              Deduct advance from this batch (₦)
              <input type="number" name="amount" min="0.01" max={outstandingDebt} step="0.01" required
                className="mt-1 block w-40 rounded border px-2 py-1 text-sm" />
            </label>
            <label className="flex-1 text-xs font-medium">
              Note
              <input type="text" name="notes" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-paper">Deduct</button>
          </form>
        )}

        {/* Manager: submit / resubmit for owner approval */}
        {/* Manager: supplier account details (captured before submitting) */}
        {(isManager || isOwner) && !locked && (
          <form action={updateSupplierAccount} className="space-y-2 border-t border-line pt-3">
            <input type="hidden" name="visit_id" value={visitId} />
            <input type="hidden" name="supplier_id" value={supplierId} />
            <AccountFields
              accounts={knownAccounts}
              defaultName={(supplier?.account_name as string | null) ?? null}
              defaultNumber={(supplier?.account_number as string | null) ?? null}
              defaultBank={(supplier?.bank_name as string | null) ?? null}
              label="Supplier account details"
            />
            <button type="submit" className="rounded border px-3 py-1 text-xs hover:bg-paper">Save account details</button>
          </form>
        )}

        {/* Accountant (and everyone once the batch is locked) sees the supplier's
            bank details read-only — needed to pay the supplier. */}
        {(isAccounting || (locked && !isManager && !isOwner)) && (
          <div className="space-y-1 border-t border-line pt-3 text-sm">
            <div className="text-xs font-medium text-ink-2">Supplier account details</div>
            {supplier?.account_name || supplier?.account_number || supplier?.bank_name ? (
              <div className="text-ink">
                {(supplier?.account_name as string | null) ?? "—"}
                {" · "}
                <span className="mono">{(supplier?.account_number as string | null) ?? "—"}</span>
                {" · "}
                {(supplier?.bank_name as string | null) ?? "—"}
              </div>
            ) : (
              <p className="text-ink-2">No account details on file yet.</p>
            )}
          </div>
        )}

        {/* No manual submit: the owner's price approval auto-creates this
            settlement and sends it straight to accounting. */}
        {(isManager || isOwner) && !status && (
          <p className="border-t border-line pt-3 text-[11px] text-ink-2">
            Apply any deductions here, then submit the priced batch to the owner — on approval this goes straight to accounting.
          </p>
        )}

        {/* Payments ledger — part or full; cash usually by the manager. */}
        {(isManager || isAccounting || isOwner) && status && ["approved", "on_hold", "partially_paid", "paid"].includes(status) && (
          <div className="border-t border-line pt-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-2">
              <span>Payments</span>
              <span>{ngn(paidTotal)} of {ngn(net)} paid{remaining > 0.005 ? ` · ${ngn(remaining)} left` : ""}</span>
            </div>
            {(payments ?? []).length === 0 ? (
              <p className="text-xs text-ink-2">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {(payments ?? []).map((p) => (
                  <li key={p.id as string} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-ink-2">
                      {METHOD_LABEL[p.method as string] ?? p.method as string}
                      {p.note ? ` · ${p.note as string}` : ""}
                      {" · "}{g1<{ full_name?: string }>((p as { payer: unknown }).payer)?.full_name ?? "—"}
                      {" · "}{formatTimestamp(p.created_at as string)}
                    </span>
                    <span className="font-medium">{ngn(Number(p.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {canRecordPayment && (
          <RecordPaymentForm visitId={visitId} settlementId={settlementId!} remaining={remaining} />
        )}
        {canCloseZero && (
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-ink-2">Nothing is owed on this batch (₦0 net) — close it to complete the settlement.</p>
            <CloseSettlementButton visitId={visitId} settlementId={settlementId!} />
          </div>
        )}

        {/* Supply invoice — available once the batch has been submitted */}
        {status && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-2">Supply invoice:</span>
            <a href={`${invoiceUrl}?format=a4`} target="_blank" rel="noreferrer"
              className="rounded border px-3 py-1 text-xs hover:bg-paper">A4 (download)</a>
            <a href={`${invoiceUrl}?format=thermal`} target="_blank" rel="noreferrer"
              className="rounded border px-3 py-1 text-xs hover:bg-paper">🖨 80mm receipt</a>
          </div>
        )}

        {status === "rejected" && settlement?.rejection_note != null && (
          <p className="border-t border-line pt-3 text-sm text-reject">Rejected: {settlement.rejection_note as string}</p>
        )}
        {status === "paid" && (
          <p className="border-t border-line pt-3 text-sm text-approve">
            Paid {ngn(Number(settlement!.net_balance))} · settlement closed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-ink-2">
      <span>{label}</span><span className="text-ink">{value}</span>
    </div>
  );
}
