import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { recordDeduction, removeDeduction, removeUtilityCharge } from "@/app/visits/[id]/finance-actions";
import { setSettlementStatus, updateSupplierAccount } from "@/app/visits/[id]/settlement-actions";
import type { Role } from "@/lib/auth/roles";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const STATUS_VARIANT: Record<string, "default" | "green" | "yellow" | "red" | "blue" | "paid"> = {
  pending: "yellow", approved: "blue", paid: "paid", rejected: "red",
};

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
  const locked = status === "approved" || status === "paid";
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
          {status && <Badge variant={STATUS_VARIANT[status] ?? "default"}>{status}</Badge>}
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
            <div className="text-xs font-medium text-ink-2">Supplier account details</div>
            <div className="grid grid-cols-3 gap-2">
              <input name="account_name" placeholder="Account name" defaultValue={(supplier?.account_name as string | null) ?? ""}
                className="rounded border px-2 py-1 text-sm" />
              <input name="account_number" placeholder="Account number" defaultValue={(supplier?.account_number as string | null) ?? ""}
                className="rounded border px-2 py-1 text-sm" />
              <input name="bank_name" placeholder="Bank" defaultValue={(supplier?.bank_name as string | null) ?? ""}
                className="rounded border px-2 py-1 text-sm" />
            </div>
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

        {/* Accountant: pay once approved (only the accountant marks paid) */}
        {isAccounting && status === "approved" && (
          <form action={setSettlementStatus} className="border-t border-line pt-3">
            <input type="hidden" name="visit_id" value={visitId} />
            <input type="hidden" name="settlement_id" value={settlement!.id as string} />
            <input type="hidden" name="status" value="paid" />
            <button type="submit" className="w-full rounded bg-ink px-3 py-2 text-sm font-semibold text-white">
              Mark paid ({ngn(Number(settlement!.net_balance))})
            </button>
          </form>
        )}

        {/* Supply invoice — available once the batch has been submitted */}
        {status && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <a href={invoiceUrl} target="_blank" rel="noreferrer"
              className="rounded border px-3 py-1 text-xs hover:bg-paper">Download supply invoice</a>
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
