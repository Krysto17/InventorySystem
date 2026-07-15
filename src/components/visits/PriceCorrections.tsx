import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceCorrectionForm } from "@/components/visits/PriceCorrectionForm";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";
import type { Role } from "@/lib/auth/roles";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Price corrections on a PAID visit — over/under-priced material after payment.
// Finance roles see the log; owner + general manager record new corrections.
export async function PriceCorrections({
  visitId,
  viewerRole,
  isGeneralManager,
  settlementStatus,
}: {
  visitId: string;
  viewerRole: Role;
  isGeneralManager: boolean;
  settlementStatus: string | null;
}) {
  if (settlementStatus !== "paid") return null;
  if (!["owner", "accounting", "manager"].includes(viewerRole)) return null;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("price_corrections")
    .select("id, direction, amount, reason, created_at, paid_at, recorded_by_profile:profiles!price_corrections_recorded_by_fkey(full_name)")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: false });

  const canRecord = viewerRole === "owner" || isGeneralManager;
  if (!canRecord && (rows?.length ?? 0) === 0) return null; // nothing to show a read-only viewer

  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Price corrections (after payment)</h2></CardHeader>
      <CardContent className="space-y-4">
        {(rows?.length ?? 0) > 0 && (
          <ul className="divide-y divide-line text-sm">
            {(rows ?? []).map((r) => {
              const by = g1<{ full_name?: string }>((r as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? "—";
              const over = r.direction === "overpaid";
              const paid = r.paid_at != null;
              return (
                <li key={r.id as string} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Badge variant={over ? "red" : "green"}>{over ? "Over-paid" : "Under-paid"}</Badge>
                    <span className="font-medium">{ngn(Number(r.amount))}</span>
                    {/* Under-paid corrections are a payable — show whether the accountant has compensated it yet. */}
                    {!over && <Badge variant={paid ? "green" : "yellow"}>{paid ? "Compensation paid" : "Awaiting accountant"}</Badge>}
                    {r.reason && <span className="text-ink-2">· {r.reason as string}</span>}
                  </span>
                  <span className="text-xs text-ink-2">{by} · {formatTimestamp(r.created_at as string)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {canRecord ? (
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-ink-2">The paid settlement stays locked. <strong>Under-paid</strong> goes to the accountant&rsquo;s payout queue to compensate the supplier; <strong>over-paid</strong> is logged for you to recover from a later supply.</p>
            <PriceCorrectionForm visitId={visitId} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
