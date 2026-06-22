import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import type { Role } from "@/lib/auth/roles";
import type { VisitState } from "@/lib/visits/state-machine";
import { authorizeGateExit, releaseSupplier } from "@/app/visits/[id]/gate-exit-actions";

import { one as g1 } from "@/lib/db/relation";

// No-agreement release gate: a manager/owner authorises, then the gate releases.
// Only renders while the visit is parked at awaiting_gate_exit.
export async function GateExitCard({
  visitId,
  visitState,
  viewerRole,
}: {
  visitId: string;
  visitState: VisitState;
  viewerRole: Role;
}) {
  if (visitState !== "awaiting_gate_exit") return null;

  const supabase = await createClient();
  const { data: auth } = await supabase
    .from("gate_exit_authorizations")
    .select("authorized_at, note, by:profiles!gate_exit_authorizations_authorized_by_fkey(full_name)")
    .eq("visit_id", visitId)
    .maybeSingle();

  const authorized = auth != null;
  const by = g1<{ full_name: string }>((auth as { by: unknown } | null)?.by);
  const canAuthorize = viewerRole === "manager" || viewerRole === "owner";
  const canRelease = viewerRole === "gate" || viewerRole === "owner";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">No-agreement release gate</h2>
          <Badge variant={authorized ? "green" : "yellow"}>
            {authorized ? "Authorised" : "Awaiting authorisation"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-ink-2">
          No purchase agreement was reached. A manager or the owner must authorise the exit before
          the gate releases the supplier. The processing fee remains owed.
        </p>

        {authorized ? (
          <div className="rounded border border-line px-3 py-2">
            <div className="font-medium">Authorised by {by?.full_name ?? "—"}</div>
            <div className="text-ink-2">{formatTimestamp(auth!.authorized_at as string)}</div>
            {auth!.note ? <div className="mt-1">“{auth!.note as string}”</div> : null}
          </div>
        ) : (
          canAuthorize && (
            <form action={authorizeGateExit} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="visit_id" value={visitId} />
              <label className="flex-1 text-xs font-medium">Note (optional)
                <input type="text" name="note" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
              <button type="submit" className="rounded bg-approve px-4 py-1.5 text-sm font-semibold text-white">
                Authorise exit
              </button>
            </form>
          )
        )}

        {authorized && canRelease && (
          <form action={releaseSupplier}>
            <input type="hidden" name="visit_id" value={visitId} />
            <button type="submit" className="rounded bg-ink px-4 py-1.5 text-sm font-semibold text-white">
              Release supplier
            </button>
          </form>
        )}

        {!authorized && !canAuthorize && (
          <p className="text-ink-2">Waiting for a manager or owner to authorise the exit.</p>
        )}
      </CardContent>
    </Card>
  );
}
