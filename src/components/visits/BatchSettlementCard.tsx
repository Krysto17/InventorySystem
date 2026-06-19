import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { recordDeduction } from "@/app/visits/[id]/finance-actions";
import { submitBatchSettlement, setSettlementStatus, updateSupplierAccount } from "@/app/visits/[id]/settlement-actions";
import type { Role } from "@/lib/auth/roles";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);
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
  const [{ data: lines }, { data: charges }, { data: deds }, { data: debt }, { data: settlement }] =
    await Promise.all([
      supabase.from("visit_materials")
        .select("id, weight_kg, unit_price, purchase_amount, material:material_types(name)")
        .eq("visit_id", visitId).order("created_at", { ascending: true }),
      supabase.from("utility_charges").select("amount").eq("visit_id", visitId),
      supabase.from("advance_deductions").select("amount, notes, created_at").eq("ref_visit_id", visitId),
      supabase.rpc("supplier_outstanding_debt", { _supplier_id: supplierId }),
      supabase.from("batch_settlements").select("*").eq("visit_id", visitId).maybeSingle(),
    ]);

  const { data: supplier } = await supabase
    .from("suppliers").select("account_name, account_number, bank_name").eq("id", supplierId).maybeSingle();

  const materials = (lines ?? []).reduce((s, l) => s + Number(l.purchase_amount ?? 0), 0);
  const light = (charges ?? []).reduce((s, c) => s + Number(c.amount), 0);
  const advance = (deds ?? []).reduce((s, d) => s + Number(d.amount), 0);
  const net = materials - light - advance;
  const outstandingDebt = Number(debt ?? 0);

  const isManager = viewerRole === "manager";
  const isOwner = viewerRole === "owner";
  const isAccounting = viewerRole === "accounting";
  const status = (settlement?.status as string | undefined) ?? null;
  const locked = status === "approved" || status === "paid";

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
          <table className="w-full text-sm">
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
          </table>
        </div>

        {/* Breakdown */}
        <div className="space-y-1 border-t border-line pt-3 text-sm">
          <Row label="Materials total" value={ngn(materials)} />
          <Row label="Processing fee" value={`− ${ngn(light)}`} />
          <Row label="Advance deducted" value={`− ${ngn(advance)}`} />
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

        {isManager && !locked && (
          <form action={submitBatchSettlement} className="border-t border-line pt-3">
            <input type="hidden" name="visit_id" value={visitId} />
            <button type="submit" className="w-full rounded bg-ore px-3 py-2 text-sm font-semibold text-white hover:bg-ore-strong">
              {status ? "Re-submit batch to owner" : "Submit batch to owner for approval"}
            </button>
          </form>
        )}

        {/* Owner: approve / reject */}
        {isOwner && status === "pending" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <form action={setSettlementStatus}>
              <input type="hidden" name="visit_id" value={visitId} />
              <input type="hidden" name="settlement_id" value={settlement!.id as string} />
              <input type="hidden" name="status" value="approved" />
              <button type="submit" className="rounded bg-approve px-3 py-1 text-sm font-semibold text-white">Approve batch</button>
            </form>
            <form action={setSettlementStatus} className="flex items-end gap-2">
              <input type="hidden" name="visit_id" value={visitId} />
              <input type="hidden" name="settlement_id" value={settlement!.id as string} />
              <input type="hidden" name="status" value="rejected" />
              <input type="text" name="rejection_note" placeholder="Reason" className="rounded border px-2 py-1 text-sm" />
              <button type="submit" className="rounded border px-3 py-1 text-sm">Reject</button>
            </form>
          </div>
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
