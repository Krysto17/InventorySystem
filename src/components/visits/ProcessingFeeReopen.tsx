import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { reopenProcessingFee } from "@/app/visits/[id]/finance-actions";
import { ProcessingFeeReopenCard } from "@/components/visits/ProcessingFeeReopenCard";
import type { Role } from "@/lib/auth/roles";

type Machine = { id: string; name: string; charge_basis: string; rate: number };

// Processing-fee correction loop: manager/owner send the fee back; the
// processing employee re-edits the machine usage and the fee recomputes.
export async function ProcessingFeeReopen({
  visitId,
  visitState,
  viewerRole,
  machines,
}: {
  visitId: string;
  visitState: string;
  viewerRole: Role;
  machines: Machine[];
}) {
  if (!["manager", "owner", "processing"].includes(viewerRole)) return null;

  const supabase = await createClient();
  const { data: rec } = await supabase
    .from("processing_records")
    .select("id, fee_reopened, usage:processing_machine_usage(machine_id, measurement)")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rec) return null; // no processing fee to send back

  const open = !["exited", "stocked"].includes(visitState);
  const reopened = Boolean(rec.fee_reopened);
  const isManager = viewerRole === "manager";
  const isOwner = viewerRole === "owner";
  const isProcessing = viewerRole === "processing";

  // Processing (or owner) corrects the fee once it's been reopened.
  if (reopened && (isProcessing || isOwner)) {
    const initialUsage = (((rec as { usage?: { machine_id: string; measurement: number }[] }).usage) ?? [])
      .map((u) => ({ machine_id: u.machine_id, measurement: String(u.measurement) }));
    return (
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Processing fee — correction requested</h2></CardHeader>
        <CardContent>
          <ProcessingFeeReopenCard visitId={visitId} machines={machines} initialUsage={initialUsage} />
        </CardContent>
      </Card>
    );
  }

  // Manager sees it's awaiting the processing employee.
  if (reopened && isManager) {
    return (
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Processing fee</h2></CardHeader>
        <CardContent><p className="text-sm text-ink-2">Sent back — awaiting the processing employee&rsquo;s correction.</p></CardContent>
      </Card>
    );
  }

  // Manager/owner may send the fee back while the visit is open.
  if ((isManager || isOwner) && open) {
    return (
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Processing fee</h2></CardHeader>
        <CardContent>
          <form action={reopenProcessingFee}>
            <input type="hidden" name="visit_id" value={visitId} />
            <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Send fee back to processing
            </button>
            <p className="mt-1 text-xs text-ink-2">Ask the processing employee to correct the machine usage / fee.</p>
          </form>
        </CardContent>
      </Card>
    );
  }

  return null;
}
