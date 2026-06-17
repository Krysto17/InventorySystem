import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { addUtilityCharge } from "@/app/visits/[id]/finance-actions";
import type { Role } from "@/lib/auth/roles";
import type { VisitState } from "@/lib/visits/state-machine";
import { isVisitOpen } from "@/lib/visits/state-machine";

const ngn = (n: number) => `₦${n.toLocaleString()}`;

export async function UtilityChargesCard({
  visitId,
  visitState,
  viewerRole,
}: {
  visitId: string;
  visitState: VisitState;
  viewerRole: Role;
}) {
  const supabase = await createClient();
  const { data: charges } = await supabase
    .from("utility_charges")
    .select("id, kind, description, amount, created_at")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });

  const canAdd =
    ["processing", "manager", "owner"].includes(viewerRole) && isVisitOpen(visitState);

  if ((charges?.length ?? 0) === 0 && !canAdd) return null;

  const total = (charges ?? []).reduce((s, c) => s + Number(c.amount), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Processing fees</h2>
          <Badge variant="yellow">{ngn(total)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {(charges?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No processing fees recorded.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {(charges ?? []).map((c) => (
              <li key={c.id as string} className="flex items-center justify-between py-2">
                <span>
                  {c.kind === "light_bill" ? "Processing fee" : "Other"}
                  {c.description != null && <span className="text-zinc-500"> · {c.description as string}</span>}
                </span>
                <span className="font-medium">{ngn(Number(c.amount))}</span>
              </li>
            ))}
          </ul>
        )}

        <a
          href={`/api/pdf/utility/${visitId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded border px-3 py-1 text-xs hover:bg-zinc-50"
        >
          Download processing invoice
        </a>

        {canAdd && (
          <form action={addUtilityCharge} className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <input type="hidden" name="visit_id" value={visitId} />
            <label className="text-xs font-medium">
              Kind
              <select name="kind" defaultValue="light_bill" className="mt-1 block rounded border px-2 py-1 text-sm">
                <option value="light_bill">Processing fee</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-xs font-medium">
              Amount (₦)
              <input type="number" name="amount" min="0.01" step="0.01" required className="mt-1 block w-32 rounded border px-2 py-1 text-sm" />
            </label>
            <label className="flex-1 text-xs font-medium">
              Description
              <input type="text" name="description" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-zinc-50">Add</button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
