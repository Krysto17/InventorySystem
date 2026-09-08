"use client";

import { useActionState, useOptimistic, useRef } from "react";
import {
  addMaterialLine,
  updateMaterialLine,
  deleteMaterialLine,
  submitToManager,
} from "@/app/visits/[id]/batch-actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ActionForm } from "@/components/ui/ActionForm";
import { fail, type ActionResult } from "@/lib/actions/result";

const INITIAL: ActionResult = { ok: false };

// The delete button owns its own action state so a refusal shows on THAT row.
// It lives here rather than in its own file because it needs the parent's
// optimistic dispatch, and a hook cannot be called inside the row loop.
function DeleteLineForm({
  visitId, lineId, onOptimisticRemove,
}: {
  visitId: string; lineId: string; onOptimisticRemove: (id: string) => void;
}) {
  const [state, action] = useActionState(
    async (prev: ActionResult, formData: FormData): Promise<ActionResult> => {
      // Optimistic first, then the server. React discards the optimistic state
      // when the action settles, so a refusal puts the row straight back.
      onOptimisticRemove(lineId);
      return deleteMaterialLine(prev, formData);
    },
    INITIAL,
  );
  return (
    <form action={action} className="mt-1">
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="visit_material_id" value={lineId} />
      <SubmitButton
        pendingText="Deleting…"
        className="rounded border border-reject px-3 py-1 text-xs text-reject hover:bg-reject-soft disabled:opacity-50"
      >
        Delete line
      </SubmitButton>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-red-600">{state.error}</p>
      )}
    </form>
  );
}

export type RxLine = {
  id: string;
  weight_kg: number;
  material_type_id: string;
  magnetic_analysis: string | null;
  receiving_comment: string | null;
  requires_analysis: boolean;
  materialName: string | null;
  pending?: boolean;
};
type MaterialType = { id: string; name: string };

type Action = { type: "add"; line: RxLine } | { type: "remove"; id: string };

// The receiving-stage line editor. Adds/deletes are optimistic (useOptimistic):
// the row appears/disappears instantly while the server action runs, then the
// revalidated server data reconciles it — so rapid entry feels immediate and
// there's no "did it work?" gap that tempts a double-click.
export function ReceivingLines({
  visitId,
  initialLines,
  materialTypes,
}: {
  visitId: string;
  initialLines: RxLine[];
  materialTypes: MaterialType[];
}) {
  const [lines, applyOptimistic] = useOptimistic(
    initialLines,
    (state: RxLine[], action: Action) =>
      action.type === "add"
        ? [...state, action.line]
        : state.filter((l) => l.id !== action.id),
  );
  const addFormRef = useRef<HTMLFormElement>(null);

  // Both wrappers now RETURN the action's result, so useActionState can show
  // it. Previously they awaited a Promise<void> and dropped whatever happened.
  const [addState, addAction] = useActionState(
    async (prev: ActionResult, formData: FormData): Promise<ActionResult> => {
    const materialId = String(formData.get("material_type_id") ?? "");
    if (!materialId) return fail("Pick a material."); // the required field normally catches this
    applyOptimistic({
      type: "add",
      line: {
        id: `optimistic-${crypto.randomUUID()}`,
        weight_kg: Number(formData.get("weight_kg")) || 0,
        material_type_id: materialId,
        magnetic_analysis: String(formData.get("magnetic_analysis") ?? "").trim() || null,
        receiving_comment: String(formData.get("receiving_comment") ?? "").trim() || null,
        requires_analysis: formData.get("requires_analysis") != null,
        materialName: materialTypes.find((m) => m.id === materialId)?.name ?? "…",
        pending: true,
      },
    });
    const result = await addMaterialLine(prev, formData);
    // Only clear the inputs once the line is really saved — a refused add used
    // to wipe what the clerk had just typed.
    if (result.ok) addFormRef.current?.reset();
    return result;
    },
    INITIAL,
  );

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500">No material lines recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {lines.map((l) => (
            <div
              key={l.id}
              className={`rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800 ${
                l.pending ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {l.materialName ?? "—"}
                  {!l.requires_analysis && (
                    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                      no analysis required
                    </span>
                  )}
                  {l.pending && (
                    <span className="ml-2 text-[10px] text-zinc-400">saving…</span>
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

              {/* Correcting / deleting only applies to real (saved) lines. */}
              {!l.pending && (
                <>
                  <ActionForm action={updateMaterialLine} className="mt-2 grid grid-cols-2 gap-2">
                    <input type="hidden" name="visit_id" value={visitId} />
                    <input type="hidden" name="visit_material_id" value={l.id} />
                    <label className="col-span-2 text-[11px] font-medium">
                      Material type
                      <select
                        name="material_type_id"
                        defaultValue={l.material_type_id}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
                      >
                        {materialTypes.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] font-medium">
                      Weight (kg)
                      <input
                        type="number"
                        name="weight_kg"
                        step="0.001"
                        min="0"
                        defaultValue={l.weight_kg}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="text-[11px] font-medium">
                      Magnetic analysis
                      <input
                        type="text"
                        name="magnetic_analysis"
                        defaultValue={l.magnetic_analysis ?? ""}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="col-span-2 text-[11px] font-medium">
                      Comment
                      <input
                        type="text"
                        name="receiving_comment"
                        defaultValue={l.receiving_comment ?? ""}
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
                      />
                    </label>
                    <SubmitButton
                      pendingText="Saving…"
                      className="col-span-2 rounded border px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                    >
                      Save correction
                    </SubmitButton>
                  </ActionForm>
                  <DeleteLineForm
                    visitId={visitId}
                    lineId={l.id}
                    onOptimisticRemove={(id) => applyOptimistic({ type: "remove", id })}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <form ref={addFormRef} action={addAction} className="grid grid-cols-2 gap-2">
          <input type="hidden" name="visit_id" value={visitId} />
          <label className="col-span-2 text-xs font-medium">
            Material
            <select
              name="material_type_id"
              required
              defaultValue=""
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            >
              <option value="" disabled>
                Select material…
              </option>
              {materialTypes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium">
            Weight (kg)
            <input
              type="number"
              name="weight_kg"
              step="0.001"
              min="0"
              required
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Magnetic analysis <span className="font-normal text-zinc-400">(Monazite only)</span>
            <input
              type="text"
              name="magnetic_analysis"
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-2 text-xs font-medium">
            Comment
            <input
              type="text"
              name="receiving_comment"
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" name="requires_analysis" defaultChecked />
            Requires chemical (XRF) analysis
          </label>
          <SubmitButton
            pendingText="Adding…"
            className="col-span-2 rounded border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
          >
            + Add material line
          </SubmitButton>
          {addState.error && (
            <p role="alert" className="col-span-2 text-xs text-red-600">{addState.error}</p>
          )}
        </form>

        {lines.length > 0 && (
          <ActionForm action={submitToManager} className="space-y-2">
            <input type="hidden" name="visit_id" value={visitId} />
            <p className="text-xs text-zinc-500">
              Material lines are saved as drafts — add or edit them above until you submit the
              batch for analysis (or straight to pricing when no line needs XRF).
            </p>
            <SubmitButton
              pendingText="Submitting…"
              className="w-full rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Submit for analysis →
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
