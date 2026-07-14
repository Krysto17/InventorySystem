import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { recordXrf, setLinePrice, finalizeLinePrice, skipToPricing, unsettleLine, resettleLine, removeLineAsManager, updateMaterialLine, addMaterialLine, submitPricedBatch, approvePricing, rejectPricing } from "@/app/visits/[id]/batch-actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ReceivingLines, type RxLine } from "@/components/visits/ReceivingLines";
import type { Role } from "@/lib/auth/roles";
import type { VisitState } from "@/lib/visits/state-machine";

type Line = {
  id: string;
  weight_kg: number;
  material_type_id: string;
  magnetic_analysis: string | null;
  receiving_comment: string | null;
  requires_analysis: boolean;
  unit_price: number | null;
  purchase_amount: number | null;
  price_finalized: boolean;
  settlement_status: string;
  unsettled_reason: string | null;
  material: { name: string } | null;
  xrf: { result: string | null; submitted: boolean; weight_kg: number | null; mismatch: boolean } | null;
};

import { one as g1 } from "@/lib/db/relation";

export async function BatchMaterials({
  visitId,
  visitState,
  viewerRole,
  isGeneralManager = false,
}: {
  visitId: string;
  visitState: VisitState;
  viewerRole: Role;
  isGeneralManager?: boolean;
}) {
  const supabase = await createClient();

  const { data: rawLines } = await supabase
    .from("visit_materials")
    .select(`
      id, weight_kg, material_type_id, magnetic_analysis, receiving_comment, requires_analysis,
      unit_price, purchase_amount, price_finalized, settlement_status, unsettled_reason,
      material:material_types(name),
      xrf:xrf_records(result, submitted, weight_kg, mismatch)
    `)
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });

  const lines: Line[] = (rawLines ?? []).map((l) => ({
    id: l.id as string,
    weight_kg: Number(l.weight_kg),
    material_type_id: l.material_type_id as string,
    magnetic_analysis: l.magnetic_analysis as string | null,
    receiving_comment: l.receiving_comment as string | null,
    requires_analysis: Boolean(l.requires_analysis),
    unit_price: l.unit_price != null ? Number(l.unit_price) : null,
    purchase_amount: l.purchase_amount != null ? Number(l.purchase_amount) : null,
    price_finalized: Boolean(l.price_finalized),
    settlement_status: (l.settlement_status as string) ?? "settled",
    unsettled_reason: (l.unsettled_reason as string | null) ?? null,
    material: g1((l as { material: unknown }).material) as { name: string } | null,
    xrf: g1((l as { xrf: unknown }).xrf) as Line["xrf"],
  }));

  // Nothing to show for legacy single-material visits with no batch lines.
  if (lines.length === 0 && visitState !== "in_receiving") return null;

  // Once the manager submits the priced batch to the owner, the supply invoice
  // is generated (agreed prices − deductions). Available from that point on to
  // manager/owner (and accounting downstream).
  const batchSubmitted = ["awaiting_price_approval", "in_accounting", "awaiting_stock_intake", "stocked"].includes(visitState);
  const canSeeInvoice = batchSubmitted && ["manager", "owner", "accounting"].includes(viewerRole);
  let invoiceUrl = "";
  if (canSeeInvoice) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
    invoiceUrl = `${origin}/api/pdf/supply-invoice/${visitId}`;
  }

  // The general (New-Site) manager runs the receiving module too.
  const canReceive = (viewerRole === "receiving" || viewerRole === "owner" || isGeneralManager) && visitState === "in_receiving";
  // Only QC records/edits an XRF (read-only for owner et al.). QC can analyse
  // through the pricing stages, so a supplier's several materials can each be
  // analysed separately, even after a manager skipped analysis to pricing.
  const canQc = viewerRole === "qc"
    && ["in_qc", "pricing", "awaiting_price_approval"].includes(visitState);
  const canPrice = (viewerRole === "manager" || viewerRole === "owner") && visitState === "pricing";
  const canSeeXrf = viewerRole === "owner" || viewerRole === "manager" || viewerRole === "qc";
  // Manager may bypass XRF from analysis straight to pricing (#3).
  const canSkipAnalysis = (viewerRole === "manager" || viewerRole === "owner") && visitState === "in_qc";
  // Manager (own site, RPC-enforced) or owner may unsettle a line before/after
  // pricing — remove it or gate-pass it out when it fails spec/pricing.
  const canUnsettle = (viewerRole === "manager" || viewerRole === "owner")
    && ["in_qc", "pricing", "in_accounting", "awaiting_stock_intake"].includes(visitState);
  // Manager/owner may correct a batch line (e.g. a kg fix) coming from receiving,
  // while the visit is still open. RLS enforces the manager's own site.
  const canEditLines = (viewerRole === "manager" || viewerRole === "owner")
    && !canReceive
    && !["exited", "stocked"].includes(visitState);

  const { data: materialTypes } = canReceive || canEditLines
    ? await supabase.from("material_types").select("id, name").order("name")
    : { data: null };

  const totalWeight = lines.reduce((s, l) => s + l.weight_kg, 0);
  // Unsettled lines are excluded from the batch purchase total.
  const totalPurchase = lines.reduce((s, l) => s + (l.settlement_status === "unsettled" ? 0 : l.purchase_amount ?? 0), 0);

  // Net payable = materials − processing fee − other deductions − advances, from
  // the single settlement_totals source (same formula the snapshot/PDF use).
  let netPayable = totalPurchase;
  let feesAndDeductions = 0;
  if (canPrice) {
    const { data: totals } = await supabase.rpc("settlement_totals", { p_visit_id: visitId });
    const t = (totals ?? [])[0] as { processing_fee: number; other_deductions: number; advances: number; net: number } | undefined;
    if (t) {
      netPayable = Number(t.net);
      feesAndDeductions = Number(t.processing_fee) + Number(t.other_deductions) + Number(t.advances);
    }
  }

  // The receiving stage (add/edit/delete draft lines) is handled client-side
  // with optimistic updates so rapid entry feels instant.
  const rxLines: RxLine[] = lines.map((l) => ({
    id: l.id,
    weight_kg: l.weight_kg,
    material_type_id: l.material_type_id,
    magnetic_analysis: l.magnetic_analysis,
    receiving_comment: l.receiving_comment,
    requires_analysis: l.requires_analysis,
    materialName: l.material?.name ?? null,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Batch materials ({lines.length})</h2>
          <Badge variant="purple">{totalWeight.toFixed(2)} kg</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canReceive ? (
          <ReceivingLines
            visitId={visitId}
            initialLines={rxLines}
            materialTypes={(materialTypes ?? []) as { id: string; name: string }[]}
          />
        ) : (
        <>
        {canSkipAnalysis && (
          <form action={skipToPricing} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel p-3">
            <span className="text-xs text-ink-2">Price this batch without waiting for XRF analysis.</span>
            <input type="hidden" name="visit_id" value={visitId} />
            <SubmitButton pendingText="Skipping…" className="shrink-0 rounded border border-line px-3 py-1 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50">
              Skip analysis → pricing
            </SubmitButton>
          </form>
        )}
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500">No material lines recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.id} className={`rounded-lg border p-3 text-sm dark:border-zinc-800 ${l.settlement_status === "unsettled" ? "border-reject/40 bg-reject-soft/30" : "border-zinc-200"}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    <span className={l.settlement_status === "unsettled" ? "line-through opacity-70" : ""}>{l.material?.name ?? "—"}</span>
                    {!l.requires_analysis && (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                        no analysis required
                      </span>
                    )}
                    {l.settlement_status === "unsettled" && (
                      <span className="ml-2 rounded bg-reject px-1.5 py-0.5 text-[10px] font-medium text-white">unsettled · gate pass</span>
                    )}
                    {canSeeXrf && l.xrf?.mismatch && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        weight mismatch
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-500">{l.weight_kg.toFixed(3)} kg</div>
                </div>
                {l.settlement_status === "unsettled" && l.unsettled_reason && (
                  <div className="mt-1 text-xs text-reject">Reason: {l.unsettled_reason}</div>
                )}
                {l.magnetic_analysis && (
                  <div className="mt-1 text-xs text-zinc-500">Magnetic: {l.magnetic_analysis}</div>
                )}
                {l.receiving_comment && (
                  <div className="text-xs text-zinc-500">Note: {l.receiving_comment}</div>
                )}

                {/* Manager/owner correction of a line from receiving (e.g. kg fix). */}
                {canEditLines && l.settlement_status !== "unsettled" && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-ink-2 hover:underline">Correct line (kg / material)</summary>
                    <form action={updateMaterialLine} className="mt-2 grid grid-cols-2 gap-2">
                      <input type="hidden" name="visit_id" value={visitId} />
                      <input type="hidden" name="visit_material_id" value={l.id} />
                      <label className="col-span-2 text-[11px] font-medium">
                        Material type
                        <select name="material_type_id" defaultValue={l.material_type_id} className="mt-1 block w-full rounded border px-2 py-1 text-sm">
                          {(materialTypes ?? []).map((m) => (
                            <option key={m.id as string} value={m.id as string}>{m.name as string}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] font-medium">
                        Weight (kg)
                        <input type="number" name="weight_kg" step="0.001" min="0" defaultValue={l.weight_kg} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
                      </label>
                      <label className="text-[11px] font-medium">
                        Magnetic analysis
                        <input type="text" name="magnetic_analysis" defaultValue={l.magnetic_analysis ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
                      </label>
                      <label className="col-span-2 text-[11px] font-medium">
                        Comment
                        <input type="text" name="receiving_comment" defaultValue={l.receiving_comment ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
                      </label>
                      <SubmitButton pendingText="Saving…" className="col-span-2 rounded border px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Save correction</SubmitButton>
                    </form>
                  </details>
                )}

                {/* XRF result — only owner / manager / qc can see it */}
                {canSeeXrf && l.xrf && (
                  <div className="mt-2 rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
                    <span className="font-medium">XRF{l.xrf.submitted ? " (submitted)" : " (draft)"}:</span>{" "}
                    {l.xrf.result ?? "—"}
                    {l.xrf.weight_kg != null && (
                      <span className="ml-2 text-zinc-500">QC weight: {Number(l.xrf.weight_kg).toFixed(3)} kg</span>
                    )}
                  </div>
                )}

                {/* QC: record / submit XRF for this line. Shown for every line
                    (each material analysed separately), even ones the manager
                    marked exempt/skipped (#2/#4). */}
                {canQc && (
                  <form action={recordXrf} className="mt-2 space-y-2">
                    <input type="hidden" name="visit_id" value={visitId} />
                    <input type="hidden" name="visit_material_id" value={l.id} />
                    <textarea
                      name="result"
                      rows={2}
                      required
                      defaultValue={l.xrf?.result ?? ""}
                      placeholder="Type XRF analysis result…"
                      className="block w-full rounded border px-2 py-1 text-sm"
                    />
                    <label className="block text-xs">
                      Weight as measured by QC (kg)
                      <input
                        type="number"
                        name="weight_kg"
                        step="0.001"
                        min="0"
                        defaultValue={l.xrf?.weight_kg ?? ""}
                        className="mt-1 block w-40 rounded border px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name="confirm" required />
                      I confirm the XRF entries for this line are correct
                    </label>
                    <div className="flex gap-2">
                      <SubmitButton name="submitted" value="false" formNoValidate pendingText="Saving…" className="rounded border px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">
                        Save draft
                      </SubmitButton>
                      <SubmitButton name="submitted" value="true" pendingText="Submitting…" className="rounded bg-black px-3 py-1 text-xs text-white disabled:opacity-50">
                        Submit
                      </SubmitButton>
                    </div>
                  </form>
                )}

                {/* Price line */}
                {l.unit_price != null && (
                  <div className="mt-2 text-xs">
                    Price: ₦{l.unit_price.toLocaleString()} / kg ·{" "}
                    <span className="font-medium">₦{(l.purchase_amount ?? 0).toLocaleString()}</span>
                    {l.price_finalized && (
                      <span className="ml-2 rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">
                        🔒 finalized by owner
                      </span>
                    )}
                    {/* Manager / inventory / owner print the price slip (grade + RA
                        are written by hand after printing). */}
                    {["manager", "owner", "inventory"].includes(viewerRole) && (
                      <a
                        href={`/api/pdf/price-slip/${l.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 rounded border px-1.5 py-0.5 text-[10px] font-medium hover:bg-zinc-50"
                      >
                        🖨 Print price slip
                      </a>
                    )}
                  </div>
                )}

                {/* Price form — manager is locked out once the owner finalizes */}
                {canPrice && (viewerRole === "owner" || !l.price_finalized) && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <form action={setLinePrice} className="flex items-end gap-2">
                      <input type="hidden" name="visit_id" value={visitId} />
                      <input type="hidden" name="visit_material_id" value={l.id} />
                      <label className="text-xs">
                        Price ₦/kg {viewerRole === "owner" ? "(final)" : "(draft)"}
                        <input
                          type="number"
                          name="unit_price"
                          step="0.01"
                          min="0"
                          defaultValue={l.unit_price ?? ""}
                          className="mt-1 block w-32 rounded border px-2 py-1 text-sm"
                        />
                      </label>
                      <SubmitButton pendingText="Saving…" className="rounded border px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Set price</SubmitButton>
                    </form>
                    {viewerRole === "owner" && l.unit_price != null && !l.price_finalized && (
                      <form action={finalizeLinePrice}>
                        <input type="hidden" name="visit_id" value={visitId} />
                        <input type="hidden" name="visit_material_id" value={l.id} />
                        <SubmitButton pendingText="Finalizing…" className="rounded bg-ore px-3 py-1 text-xs font-semibold text-white hover:bg-ore-strong disabled:opacity-50">
                          Finalize price
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                )}
                {canPrice && viewerRole !== "owner" && l.price_finalized && (
                  <div className="mt-2 text-xs text-zinc-500">Price finalized by owner — locked.</div>
                )}

                {/* Unsettle a line that fails spec/pricing (#): remove it, or
                    gate-pass it out (excluded from the batch total). Reversible. */}
                {canUnsettle && (
                  <div className="mt-3 border-t border-line/60 pt-2">
                    {l.settlement_status === "unsettled" ? (
                      <form action={resettleLine} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="visit_id" value={visitId} />
                        <input type="hidden" name="visit_material_id" value={l.id} />
                        <span className="text-xs text-reject">Excluded from settlement · gate pass issued.</span>
                        <SubmitButton pendingText="…" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Re-settle</SubmitButton>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-ink-2">Fails spec/pricing?</span>
                        <form action={unsettleLine} className="flex items-center gap-1">
                          <input type="hidden" name="visit_id" value={visitId} />
                          <input type="hidden" name="visit_material_id" value={l.id} />
                          <input type="text" name="reason" placeholder="reason (optional)" className="w-36 rounded border px-2 py-1 text-xs" />
                          <SubmitButton pendingText="…" className="rounded border border-reject px-2 py-1 text-xs text-reject hover:bg-reject-soft disabled:opacity-50">Unsettle → gate pass</SubmitButton>
                        </form>
                        <form action={removeLineAsManager}>
                          <input type="hidden" name="visit_id" value={visitId} />
                          <input type="hidden" name="visit_material_id" value={l.id} />
                          <SubmitButton pendingText="Removing…" className="rounded border border-reject px-2 py-1 text-xs text-reject hover:bg-reject-soft disabled:opacity-50">Remove line</SubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Manager: add a missing material line while pricing (before submitting). */}
        {canPrice && (
          <details className="border-t border-line pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-ink-2">+ Add a material line</summary>
            <form action={addMaterialLine} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="visit_id" value={visitId} />
              <label className="text-xs font-medium">
                Material
                <select name="material_type_id" required defaultValue="" className="mt-1 block rounded border px-2 py-1 text-sm">
                  <option value="" disabled>Select…</option>
                  {((materialTypes ?? []) as { id: string; name: string }[]).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                Weight (kg)
                <input type="number" name="weight_kg" min="0" step="0.001" required className="mt-1 block w-28 rounded border px-2 py-1 text-sm" />
              </label>
              <SubmitButton pendingText="Adding…" className="rounded border px-3 py-1 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50">Add line</SubmitButton>
            </form>
          </details>
        )}

        {lines.length > 0 && totalPurchase > 0 && (
          canPrice ? (
            <div className="text-sm">
              Net payable: <span className="font-semibold">₦{netPayable.toLocaleString()}</span>
              {feesAndDeductions > 0 && (
                <span className="text-ink-2"> · materials ₦{totalPurchase.toLocaleString()} − fees/deductions ₦{feesAndDeductions.toLocaleString()}</span>
              )}
            </div>
          ) : (
            <div className="text-sm">
              Batch purchase total: <span className="font-semibold">₦{totalPurchase.toLocaleString()}</span>
            </div>
          )
        )}

        {/* Manager: submit the priced batch to the owner (→ awaiting approval,
            Pricing node green). One click, amount from the line prices. */}
        {canPrice && totalPurchase > 0 && (
          <form action={submitPricedBatch} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <input type="hidden" name="visit_id" value={visitId} />
            <label className="text-xs font-medium">
              Payment terms
              <select name="payment_terms" defaultValue="immediate" className="mt-1 block rounded border px-2 py-1 text-sm">
                <option value="immediate">Immediate</option>
                <option value="deferred">Deferred (pay later)</option>
                <option value="installment">Installments</option>
                <option value="deducted">Deduct from processing fee</option>
              </select>
            </label>
            <SubmitButton pendingText="Submitting…" className="rounded bg-ore px-3 py-2 text-sm font-semibold text-white hover:bg-ore-strong disabled:opacity-50">
              Submit priced batch to owner →
            </SubmitButton>
          </form>
        )}

        {/* Owner: approve (finalize + release to accounting) or send back. */}
        {viewerRole === "owner" && visitState === "awaiting_price_approval" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-2">Priced batch awaiting your approval:</span>
            <form action={approvePricing}>
              <input type="hidden" name="visit_id" value={visitId} />
              <SubmitButton pendingText="Approving…" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Approve &amp; finalize</SubmitButton>
            </form>
            <form action={rejectPricing}>
              <input type="hidden" name="visit_id" value={visitId} />
              <SubmitButton pendingText="…" className="rounded border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50 disabled:opacity-50">Send back</SubmitButton>
            </form>
          </div>
        )}
        {visitState === "awaiting_price_approval" && viewerRole === "manager" && (
          <p className="border-t border-line pt-3 text-xs text-green-700">Priced batch submitted — awaiting owner approval.</p>
        )}

        {/* Supply invoice — generated once the manager submits the priced batch. */}
        {canSeeInvoice && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-2">Supply invoice:</span>
            <a href={invoiceUrl} target="_blank" rel="noreferrer"
              className="rounded border px-3 py-1 text-xs hover:bg-paper">Download / print invoice</a>
          </div>
        )}
        </>
        )}
      </CardContent>
    </Card>
  );
}
