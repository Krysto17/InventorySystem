import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { addMaterialLine, updateMaterialLine, advanceToQc, recordXrf, setLinePrice, finalizeLinePrice } from "@/app/visits/[id]/batch-actions";
import type { Role } from "@/lib/auth/roles";
import type { VisitState } from "@/lib/visits/state-machine";

type Line = {
  id: string;
  weight_kg: number;
  magnetic_analysis: string | null;
  receiving_comment: string | null;
  requires_analysis: boolean;
  unit_price: number | null;
  purchase_amount: number | null;
  price_finalized: boolean;
  material: { name: string } | null;
  xrf: { result: string | null; submitted: boolean; weight_kg: number | null; mismatch: boolean } | null;
};

const g1 = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function BatchMaterials({
  visitId,
  visitState,
  viewerRole,
}: {
  visitId: string;
  visitState: VisitState;
  viewerRole: Role;
}) {
  const supabase = await createClient();

  const { data: rawLines } = await supabase
    .from("visit_materials")
    .select(`
      id, weight_kg, magnetic_analysis, receiving_comment, requires_analysis,
      unit_price, purchase_amount, price_finalized,
      material:material_types(name),
      xrf:xrf_records(result, submitted, weight_kg, mismatch)
    `)
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });

  const lines: Line[] = (rawLines ?? []).map((l) => ({
    id: l.id as string,
    weight_kg: Number(l.weight_kg),
    magnetic_analysis: l.magnetic_analysis as string | null,
    receiving_comment: l.receiving_comment as string | null,
    requires_analysis: Boolean(l.requires_analysis),
    unit_price: l.unit_price != null ? Number(l.unit_price) : null,
    purchase_amount: l.purchase_amount != null ? Number(l.purchase_amount) : null,
    price_finalized: Boolean(l.price_finalized),
    material: g1((l as { material: unknown }).material) as { name: string } | null,
    xrf: g1((l as { xrf: unknown }).xrf) as Line["xrf"],
  }));

  // Nothing to show for legacy single-material visits with no batch lines.
  if (lines.length === 0 && visitState !== "in_receiving") return null;

  const canReceive = (viewerRole === "receiving" || viewerRole === "owner") && visitState === "in_receiving";
  const canQc = (viewerRole === "qc" || viewerRole === "owner") && visitState === "in_qc";
  const canPrice = (viewerRole === "manager" || viewerRole === "owner") && visitState === "pricing";
  const canSeeXrf = viewerRole === "owner" || viewerRole === "manager" || viewerRole === "qc";

  const { data: materialTypes } = canReceive
    ? await supabase.from("material_types").select("id, name").order("name")
    : { data: null };

  const totalWeight = lines.reduce((s, l) => s + l.weight_kg, 0);
  const totalPurchase = lines.reduce((s, l) => s + (l.purchase_amount ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Batch materials ({lines.length})</h2>
          <Badge variant="purple">{totalWeight.toFixed(2)} kg</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500">No material lines recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {l.material?.name ?? "—"}
                    {!l.requires_analysis && (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                        no analysis required
                      </span>
                    )}
                    {canSeeXrf && l.xrf?.mismatch && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        weight mismatch
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-500">{l.weight_kg.toFixed(3)} kg</div>
                </div>
                {l.magnetic_analysis && (
                  <div className="mt-1 text-xs text-zinc-500">Magnetic: {l.magnetic_analysis}</div>
                )}
                {l.receiving_comment && (
                  <div className="text-xs text-zinc-500">Note: {l.receiving_comment}</div>
                )}

                {/* Receiving: correct a line's entries before sending to QC */}
                {canReceive && (
                  <form action={updateMaterialLine} className="mt-2 grid grid-cols-2 gap-2">
                    <input type="hidden" name="visit_id" value={visitId} />
                    <input type="hidden" name="visit_material_id" value={l.id} />
                    <label className="text-[11px] font-medium">
                      Weight (kg)
                      <input type="number" name="weight_kg" step="0.001" min="0" defaultValue={l.weight_kg}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
                    </label>
                    <label className="text-[11px] font-medium">
                      Magnetic analysis
                      <input type="text" name="magnetic_analysis" defaultValue={l.magnetic_analysis ?? ""}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
                    </label>
                    <label className="col-span-2 text-[11px] font-medium">
                      Comment
                      <input type="text" name="receiving_comment" defaultValue={l.receiving_comment ?? ""}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
                    </label>
                    <button type="submit" className="col-span-2 rounded border px-3 py-1 text-xs hover:bg-zinc-50">Save correction</button>
                  </form>
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

                {/* QC: record / submit XRF for this line. Submitting requires a
                    result + confirmation; Save draft bypasses validation. */}
                {canQc && l.requires_analysis && (
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
                      <button name="submitted" value="false" type="submit" formNoValidate className="rounded border px-3 py-1 text-xs hover:bg-zinc-50">
                        Save draft
                      </button>
                      <button name="submitted" value="true" type="submit" className="rounded bg-black px-3 py-1 text-xs text-white">
                        Submit
                      </button>
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
                      <button type="submit" className="rounded border px-3 py-1 text-xs hover:bg-zinc-50">Set price</button>
                    </form>
                    {viewerRole === "owner" && l.unit_price != null && !l.price_finalized && (
                      <form action={finalizeLinePrice}>
                        <input type="hidden" name="visit_id" value={visitId} />
                        <input type="hidden" name="visit_material_id" value={l.id} />
                        <button type="submit" className="rounded bg-ore px-3 py-1 text-xs font-semibold text-white hover:bg-ore-strong">
                          Finalize price
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {canPrice && viewerRole !== "owner" && l.price_finalized && (
                  <div className="mt-2 text-xs text-zinc-500">Price finalized by owner — locked.</div>
                )}
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && totalPurchase > 0 && (
          <div className="text-sm">
            Batch purchase total: <span className="font-semibold">₦{totalPurchase.toLocaleString()}</span>
          </div>
        )}

        {/* Receiving: add lines + advance to QC */}
        {canReceive && (
          <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <form action={addMaterialLine} className="grid grid-cols-2 gap-2">
              <input type="hidden" name="visit_id" value={visitId} />
              <label className="col-span-2 text-xs font-medium">
                Material
                <select name="material_type_id" required defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
                  <option value="" disabled>Select material…</option>
                  {(materialTypes ?? []).map((m) => (
                    <option key={m.id as string} value={m.id as string}>{m.name as string}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                Weight (kg)
                <input type="number" name="weight_kg" step="0.001" min="0" required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
              <label className="text-xs font-medium">
                Magnetic analysis <span className="font-normal text-zinc-400">(Monazite only)</span>
                <input type="text" name="magnetic_analysis" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
              <label className="col-span-2 text-xs font-medium">
                Comment
                <input type="text" name="receiving_comment" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" name="requires_analysis" defaultChecked />
                Requires chemical (XRF) analysis
              </label>
              <button type="submit" className="col-span-2 rounded border px-3 py-1.5 text-sm hover:bg-zinc-50">
                + Add material line
              </button>
            </form>

            {lines.length > 0 && (
              <form action={advanceToQc} className="space-y-2">
                <input type="hidden" name="visit_id" value={visitId} />
                <p className="text-xs text-zinc-500">
                  Material lines are saved as drafts — add or edit them above until
                  you send the batch on.
                </p>
                <button type="submit" className="w-full rounded bg-black px-3 py-2 text-sm text-white">
                  {lines.some((l) => l.requires_analysis)
                    ? "Send to QC →"
                    : "Send to pricing (no analysis needed) →"}
                </button>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
