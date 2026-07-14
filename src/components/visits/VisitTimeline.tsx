import { VisitOriginCard } from "./VisitOriginCard";
import { ProcessingCard } from "./ProcessingCard";
import { AnalysisCard } from "./AnalysisCard";
import { PricingCard } from "./PricingCard";
import { StockIntakeCard } from "./StockIntakeCard";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";
import { formatNaira, formatTimestamp, formatWeight } from "@/lib/visits/format";

type Machine = { id: string; name: string; charge_basis: "weight" | "bag" | "hour" | "minute"; rate: number };

export type VisitTimelineProps = {
  visit: {
    id: string;
    state: VisitState;
    entry_path: "unprocessed" | "processed";
    created_at: string;
    closed_at: string | null;
    site: { name: string } | null;
    supplier: { name: string; phone: string | null } | null;
    declared_material_type: { name: string } | null;
    created_by_name: string | null;
  };
  processing: {
    id: string;
    recorded_by_name: string | null;
    completed_at: string | null;
    discount_percent: number;
    usage: {
      machine_name: string;
      charge_basis: string;
      measurement: number;
      rate_snapshot: number;
      line_cost: number;
    }[];
  } | null;
  analysis: {
    id: string;
    weight: number;
    grade: string | null;
    purity: number | null;
    sample_id: string | null;
    qc_observations: string | null;
    xrf_result: unknown;
    recorded_by_name: string | null;
    analyzed_at: string | null;
  } | null;
  pricing: {
    id: string;
    unit_price: number | null;
    purchase_amount: number | null;
    agreement_status: "pending" | "agreed" | "not_agreed";
    payment_terms: "immediate" | "deferred" | "installment" | "deducted" | null;
    priced_by_name: string | null;
    overridden_by_name: string | null;
  } | null;
  viewer: {
    role:
      | "processing"
      | "receiving"
      | "manager"
      | "accounting"
      | "inventory"
      | "owner";
  };
  machines: Machine[];
  materialTypes: { id: string; name: string }[];
  stockMovement: Parameters<typeof StockIntakeCard>[0]["stockMovement"];
};

export function VisitTimeline(props: VisitTimelineProps) {
  const { visit, processing, analysis, pricing, viewer, machines, materialTypes, stockMovement } = props;
  const isOwner = viewer.role === "owner";

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-4">
      <header className="border rounded p-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-semibold">Visit {visit.id.slice(0, 8)}</h1>
            <div className="text-sm text-gray-600">
              {visit.site?.name ?? "—"} · {visit.supplier?.name ?? "—"} ·{" "}
              {visit.declared_material_type?.name ?? "—"}
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block px-2 py-1 text-xs rounded bg-gray-100">
              {STATE_LABELS[visit.state]}
            </span>
            <div className="text-xs text-gray-500 mt-1">
              Opened {formatTimestamp(visit.created_at)}
            </div>
            {visit.closed_at && (
              <div className="text-xs text-gray-500">
                Closed {formatTimestamp(visit.closed_at)}
              </div>
            )}
          </div>
        </div>
      </header>

      <VisitOriginCard
        supplier={visit.supplier}
        material={visit.declared_material_type}
        entryPath={visit.entry_path}
        createdAt={visit.created_at}
        createdByName={visit.created_by_name}
      />

      {visit.entry_path === "unprocessed" && (
        <section className="border rounded p-4">
          <div className="text-xs uppercase text-gray-500 mb-1">Processing</div>
          {processing ? (
            <>
              <ul className="text-sm">
                {processing.usage.map((u, i) => (
                  <li key={i}>
                    {u.machine_name}: {u.measurement} {u.charge_basis} ×{" "}
                    {formatNaira(u.rate_snapshot)} = {formatNaira(u.line_cost)}
                  </li>
                ))}
              </ul>
              <div className="text-sm mt-2">
                Total fee:{" "}
                <strong>
                  {formatNaira(
                    processing.usage.reduce((s, u) => s + Number(u.line_cost), 0) *
                      (1 - processing.discount_percent / 100),
                  )}
                </strong>
              </div>
              {/* Discount is visible to managers + owner only (#7). */}
              {processing.discount_percent > 0 && (viewer.role === "manager" || isOwner) && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {processing.discount_percent}% processing discount applied
                </div>
              )}
              <div className="text-xs text-gray-500 mt-1">
                {processing.recorded_by_name ?? "—"} ·{" "}
                {formatTimestamp(processing.completed_at)}
              </div>
            </>
          ) : visit.state === "in_processing" &&
            (viewer.role === "processing" || isOwner) ? (
            <ProcessingCard visitId={visit.id} machines={machines} materialTypes={materialTypes} />
          ) : (
            <p className="text-sm text-gray-600">Pending processing.</p>
          )}
        </section>
      )}

      <section className="border rounded p-4">
        <div className="text-xs uppercase text-gray-500 mb-1">Analysis</div>
        {analysis ? (
          <>
            <div className="text-sm">
              Weight: <strong>{formatWeight(analysis.weight)}</strong> · Grade:{" "}
              <strong>{analysis.grade ?? "—"}</strong>
              {analysis.purity != null && (
                <>
                  {" "}
                  · Purity: <strong>{analysis.purity}%</strong>
                </>
              )}
            </div>
            {analysis.sample_id && (
              <div className="text-sm text-gray-600">Sample: {analysis.sample_id}</div>
            )}
            {analysis.qc_observations && (
              <div className="text-sm text-gray-600 mt-1">{analysis.qc_observations}</div>
            )}
            {analysis.xrf_result ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">View raw XRF</summary>
                <pre className="bg-gray-50 p-2 rounded mt-1 overflow-x-auto">
                  {JSON.stringify(analysis.xrf_result, null, 2)}
                </pre>
              </details>
            ) : null}
            <div className="text-xs text-gray-500 mt-2">
              {analysis.recorded_by_name ?? "—"} · {formatTimestamp(analysis.analyzed_at)}
            </div>
          </>
        ) : visit.state === "in_receiving" && (viewer.role === "receiving" || isOwner) ? (
          <AnalysisCard visitId={visit.id} />
        ) : (
          <p className="text-sm text-gray-600">Pending analysis.</p>
        )}
      </section>

      <section className="border rounded p-4">
        <div className="text-xs uppercase text-gray-500 mb-1">Pricing</div>
        {pricing && pricing.agreement_status !== "pending" ? (
          <div className="text-sm">
            Unit price: <strong>{formatNaira(pricing.unit_price)}</strong> · Total:{" "}
            <strong>{formatNaira(pricing.purchase_amount)}</strong>
            <div className="mt-1">
              Status: <strong>{pricing.agreement_status}</strong>
              {pricing.payment_terms && (
                <>
                  {" "}
                  · Terms: <strong>{pricing.payment_terms}</strong>
                </>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Priced by {pricing.priced_by_name ?? "—"}
              {pricing.overridden_by_name && (
                <> · Overridden by {pricing.overridden_by_name}</>
              )}
            </div>
          </div>
        ) : visit.state === "awaiting_price_approval" ? (
          <p className="text-sm text-green-700">Priced batch submitted — awaiting owner approval.</p>
        ) : visit.state === "pricing" && (viewer.role === "manager" || isOwner) ? (
          // Shown even without an analysis_records row (multi-material / skipped
          // batches) so the manager can submit the priced batch to the owner (#3).
          <PricingCard
            visitId={visit.id}
            analysisWeight={analysis?.weight ?? null}
            existing={
              pricing
                ? {
                    id: pricing.id,
                    unit_price: pricing.unit_price,
                    agreement_status: pricing.agreement_status,
                    payment_terms: pricing.payment_terms,
                  }
                : null
            }
          />
        ) : (
          <p className="text-sm text-gray-600">Pending pricing.</p>
        )}
      </section>

      {(visit.state === "awaiting_stock_intake" ||
        visit.state === "stocked" ||
        stockMovement) && (
        <StockIntakeCard
          visitId={visit.id}
          visitState={visit.state}
          analysisWeight={analysis?.weight ?? null}
          analysisGrade={analysis?.grade ?? null}
          canWrite={viewer.role === "inventory" || isOwner}
          stockMovement={stockMovement}
        />
      )}

    </main>
  );
}
