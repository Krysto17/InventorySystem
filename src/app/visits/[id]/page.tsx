import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { VisitTimeline } from "@/components/visits/VisitTimeline";
import { ApprovalChain } from "@/components/visits/ApprovalChain";
import { Stamp, Eyebrow } from "@/components/ui/stamp";
import { Badge, stateVariant } from "@/components/ui/badge";
import { STATE_LABELS } from "@/lib/visits/state-machine";
import { BatchMaterials } from "@/components/visits/BatchMaterials";
import { DeleteBatchButton } from "@/components/visits/DeleteBatchButton";
import { UtilityChargesCard } from "@/components/visits/UtilityChargesCard";
import { SupplierFinanceCard } from "@/components/visits/SupplierFinanceCard";
import { BatchSettlementCard } from "@/components/visits/BatchSettlementCard";
import { ProcessingFeeReopen } from "@/components/visits/ProcessingFeeReopen";
import { GateExitCard } from "@/components/visits/GateExitCard";
import { PdfDownloadBar } from "@/components/visits/PdfDownloadBar";
import { BatchComments } from "@/components/visits/BatchComments";
import { one as get1 } from "@/lib/db/relation";
import type { Role } from "@/lib/auth/roles";
import type { VisitState } from "@/lib/visits/state-machine";

export default async function VisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getProfile();
  if (!me) notFound();
  const supabase = await createClient();

  // All of a visit's facets are independent reads — fire them in one round-trip
  // instead of a 10-deep await waterfall (perf, #10).
  const [
    { data: visit },
    { data: pr },
    { data: an },
    { data: pricingRow },
    { data: materialTypes },
    { data: machines },
    { count: finalizedCount },
    { data: settlement },
    { data: paymentsRaw },
    { data: stockMovementRaw },
  ] = await Promise.all([
    supabase
      .from("visits")
      .select(`
        id, state, entry_path, created_at, closed_at, processing_deducted,
        supplier_id,
        site:sites(name),
        supplier:suppliers(name, phone),
        declared_material_type:material_types(name),
        created_by_profile:profiles!visits_created_by_fkey(full_name)
      `)
      .eq("id", id)
      .single(),
    supabase
      .from("processing_records")
      .select(`
        id, completed_at, discount_percent,
        recorded_by_profile:profiles!processing_records_recorded_by_fkey(full_name),
        usage:processing_machine_usage(
          measurement, rate_snapshot, line_cost,
          machine:machines(name, charge_basis)
        )
      `)
      .eq("visit_id", id)
      .maybeSingle(),
    supabase
      .from("analysis_records")
      .select(`
        id, weight, grade, purity, sample_id, qc_observations, xrf_result, analyzed_at,
        recorded_by_profile:profiles!analysis_records_recorded_by_fkey(full_name)
      `)
      .eq("visit_id", id)
      .maybeSingle(),
    supabase
      .from("pricing")
      .select(`
        id, unit_price, purchase_amount, agreement_status, payment_terms,
        priced_by_profile:profiles!pricing_priced_by_fkey(full_name),
        overridden_by_profile:profiles!pricing_overridden_by_fkey(full_name)
      `)
      .eq("visit_id", id)
      .maybeSingle(),
    supabase.from("material_types").select("id, name").eq("active", true).order("name"),
    supabase.from("machines").select("id, name, charge_basis, rate").eq("active", true),
    supabase
      .from("visit_materials")
      .select("id", { count: "exact", head: true })
      .eq("visit_id", id)
      .eq("price_finalized", true),
    supabase.from("batch_settlements").select("status").eq("visit_id", id).maybeSingle(),
    supabase
      .from("payments")
      .select(`
        id, direction, amount, method, notes, paid_at, status,
        recorded_by_profile:profiles!payments_recorded_by_fkey(full_name)
      `)
      .eq("visit_id", id)
      .order("paid_at", { ascending: true }),
    supabase
      .from("stock_movements")
      .select(`
        id, weight, grade, created_at,
        recorded_by_profile:profiles!stock_movements_recorded_by_fkey(full_name)
      `)
      .eq("ref_visit_id", id)
      .eq("reason", "purchase_intake")
      .maybeSingle(),
  ]);
  if (!visit) notFound();

  // Owner-finalised price → green "Director OK" node in the chain.
  const priceApproved = (finalizedCount ?? 0) > 0;

  // Batch delete gate (#4/#5): general manager may delete until owner-approval,
  // owner until paid. Mirrors the delete_batch RPC, which re-checks server-side.
  const settlementStatus = (settlement?.status as string | null) ?? null;
  const canDeleteBatch =
    (me.role === "owner" && settlementStatus !== "paid") ||
    (!!me.is_general_manager &&
      settlementStatus !== "approved" &&
      settlementStatus !== "paid");

  const visitNorm = {
    id: visit.id as string,
    state: visit.state as VisitState,
    entry_path: visit.entry_path as "unprocessed" | "processed",
    created_at: visit.created_at as string,
    closed_at: visit.closed_at as string | null,
    site: get1((visit as { site: unknown }).site) as { name: string } | null,
    supplier: get1((visit as { supplier: unknown }).supplier) as {
      name: string;
      phone: string | null;
    } | null,
    declared_material_type: get1(
      (visit as { declared_material_type: unknown }).declared_material_type,
    ) as { name: string } | null,
    created_by_name:
      (
        get1(
          (visit as { created_by_profile: unknown }).created_by_profile,
        ) as { full_name?: string } | null
      )?.full_name ?? null,
  };

  const processingNorm = pr
    ? {
        id: pr.id as string,
        recorded_by_name:
          (
            get1(
              (pr as { recorded_by_profile: unknown }).recorded_by_profile,
            ) as { full_name?: string } | null
          )?.full_name ?? null,
        completed_at: pr.completed_at as string | null,
        discount_percent: Number((pr as { discount_percent?: number }).discount_percent ?? 0),
        usage: ((pr as { usage: unknown[] }).usage ?? []).map((u) => {
          const row = u as {
            machine: { name: string; charge_basis: string } | null | unknown[];
            measurement: number;
            rate_snapshot: number;
            line_cost: number;
          };
          const m = get1(row.machine as unknown) ?? { name: "—", charge_basis: "—" };
          const machine = m as { name: string; charge_basis: string };
          return {
            machine_name: machine.name,
            charge_basis: machine.charge_basis,
            measurement: Number(row.measurement),
            rate_snapshot: Number(row.rate_snapshot),
            line_cost: Number(row.line_cost),
          };
        }),
      }
    : null;

  const analysisNorm = an
    ? {
        id: an.id as string,
        weight: Number(an.weight),
        grade: an.grade as string | null,
        purity: an.purity != null ? Number(an.purity) : null,
        sample_id: an.sample_id as string | null,
        qc_observations: an.qc_observations as string | null,
        xrf_result: an.xrf_result,
        recorded_by_name:
          (
            get1(
              (an as { recorded_by_profile: unknown }).recorded_by_profile,
            ) as { full_name?: string } | null
          )?.full_name ?? null,
        analyzed_at: an.analyzed_at as string | null,
      }
    : null;

  const pricingNorm = pricingRow
    ? {
        id: pricingRow.id as string,
        unit_price: pricingRow.unit_price != null ? Number(pricingRow.unit_price) : null,
        purchase_amount:
          pricingRow.purchase_amount != null ? Number(pricingRow.purchase_amount) : null,
        agreement_status: pricingRow.agreement_status as "pending" | "agreed" | "not_agreed",
        payment_terms: pricingRow.payment_terms as
          | "immediate"
          | "deferred"
          | "installment"
          | "deducted"
          | null,
        priced_by_name:
          (
            get1(
              (pricingRow as { priced_by_profile: unknown }).priced_by_profile,
            ) as { full_name?: string } | null
          )?.full_name ?? null,
        overridden_by_name:
          (
            get1(
              (pricingRow as { overridden_by_profile: unknown }).overridden_by_profile,
            ) as { full_name?: string } | null
          )?.full_name ?? null,
      }
    : null;


  const paymentsNorm = (paymentsRaw ?? []).map((p) => ({
    id: p.id as string,
    direction: p.direction as "processing_fee_in" | "purchase_amount_out",
    amount: Number(p.amount),
    method: p.method as string | null,
    notes: p.notes as string | null,
    paid_at: p.paid_at as string,
    recorded_by_name:
      (
        get1(
          (p as { recorded_by_profile: unknown }).recorded_by_profile,
        ) as { full_name?: string } | null
      )?.full_name ?? null,
  }));

  // Compute processing fee owed from processing_machine_usage line costs
  const processingFeeOwed =
    processingNorm
      ? processingNorm.usage.reduce((s, u) => s + Number(u.line_cost), 0)
      : null;
  // Only executed payments count toward balances (Phase 11: pending/approved/
  // rejected rows are workflow states, not money moved).
  const executed = new Set(["paid", "partially_paid"]);
  const isExecuted = (p: { id: string }) => {
    const raw = (paymentsRaw ?? []).find((r) => r.id === p.id);
    return raw == null || executed.has((raw.status as string) ?? "paid");
  };
  const processingFeePaid = paymentsNorm
    .filter((p) => p.direction === "processing_fee_in" && isExecuted(p))
    .reduce((s, p) => s + p.amount, 0);
  const purchaseAmountOwed = pricingNorm?.purchase_amount ?? null;
  const purchaseAmountPaid = paymentsNorm
    .filter((p) => p.direction === "purchase_amount_out" && isExecuted(p))
    .reduce((s, p) => s + p.amount, 0);

  const paymentBalance = {
    processingFeeOwed,
    processingFeePaid,
    purchaseAmountOwed,
    purchaseAmountPaid,
    processingDeducted: !!(visit as { processing_deducted?: boolean }).processing_deducted,
  };

  const stockMovementNorm = stockMovementRaw
    ? {
        id: stockMovementRaw.id as string,
        weight: Number(stockMovementRaw.weight),
        grade: stockMovementRaw.grade as string | null,
        created_at: stockMovementRaw.created_at as string,
        recorded_by_name:
          (
            get1(
              (stockMovementRaw as { recorded_by_profile: unknown }).recorded_by_profile,
            ) as { full_name?: string } | null
          )?.full_name ?? null,
      }
    : null;

  return (
    <div className="space-y-4 p-6">
      <header className="space-y-3 border-b-[1.5px] border-line pb-4">
        <Eyebrow>{visitNorm.site?.name ?? "—"} · supply visit</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            {visitNorm.supplier?.name ?? "—"}
          </h1>
          <Stamp>{visitNorm.id.slice(0, 8).toUpperCase()}</Stamp>
          <Badge variant={stateVariant(visitNorm.state)}>
            {STATE_LABELS[visitNorm.state] ?? visitNorm.state}
          </Badge>
        </div>
        <ApprovalChain
          state={visitNorm.state}
          entryPath={visitNorm.entry_path}
          priceApproved={priceApproved}
        />
        {canDeleteBatch && (
          <div className="flex justify-end">
            <DeleteBatchButton visitId={visitNorm.id} />
          </div>
        )}
      </header>
      <PdfDownloadBar
        visitId={visitNorm.id}
        visitState={visitNorm.state}
        viewerRole={me.role as VisitTimelineProps["viewer"]["role"]}
        hasProcessing={processingNorm !== null}
        hasAnalysis={analysisNorm !== null}
        hasPricing={pricingNorm !== null && pricingNorm.agreement_status !== "pending"}
        hasPayments={paymentsNorm.length > 0}
      />
    <GateExitCard
      visitId={visitNorm.id}
      visitState={visitNorm.state}
      viewerRole={me.role as Role}
    />
    {visitNorm.state !== "in_processing" && (
      <BatchMaterials
        visitId={visitNorm.id}
        visitState={visitNorm.state}
        viewerRole={me.role as Role}
        isGeneralManager={!!me.is_general_manager}
      />
    )}
    <UtilityChargesCard
      visitId={visitNorm.id}
      visitState={visitNorm.state}
      viewerRole={me.role as Role}
    />
    <ProcessingFeeReopen
      visitId={visitNorm.id}
      visitState={visitNorm.state}
      viewerRole={me.role as Role}
      machines={(machines ?? []) as { id: string; name: string; charge_basis: string; rate: number }[]}
    />
    <BatchComments visitId={visitNorm.id} viewerRole={me.role as Role} />
    <BatchSettlementCard
      visitId={visitNorm.id}
      supplierId={(visit as { supplier_id?: string }).supplier_id ?? null}
      viewerRole={me.role as Role}
    />
    <SupplierFinanceCard
      visitId={visitNorm.id}
      supplierId={(visit as { supplier_id?: string }).supplier_id ?? null}
      viewerRole={me.role as Role}
    />
    <VisitTimeline
      visit={visitNorm}
      processing={processingNorm}
      analysis={analysisNorm}
      pricing={pricingNorm}
      payments={paymentsNorm}
      paymentBalance={paymentBalance}
      viewer={{ role: me.role as VisitTimelineProps["viewer"]["role"] }}
      machines={
        (machines ?? []) as {
          id: string;
          name: string;
          charge_basis: "weight" | "bag" | "hour" | "minute";
          rate: number;
        }[]
      }
      materialTypes={(materialTypes ?? []) as { id: string; name: string }[]}
      stockMovement={stockMovementNorm}
    />
    </div>
  );
}

type VisitTimelineProps = import("@/components/visits/VisitTimeline").VisitTimelineProps;
