import { createClient } from "@/lib/supabase/server";

export type RawAnalysisRow = {
  lineId: string;
  visitId: string;
  date: string;
  supplier: string;
  site: string;
  material: string;
  result: string | null;
  qcWeight: number | null;
  unitPrice: number | null;
  priceAgreed: boolean;
  state: string;
  settlementStatus: string; // 'settled' | 'unsettled' (released)
  unsettledReason: string | null;
  gatePassId: string | null; // the pass raised when the material was released
};

// The price is agreed/settled once the batch has left pricing (owner gate onward).
export const AGREED_STATES = ["awaiting_price_approval", "in_accounting", "awaiting_stock_intake", "stocked"];

/**
 * XRF analyses for the analyses screens.
 *
 * Reads the flat `xrf_analyses` view (0136) and searches in Postgres — this
 * gains a row per material line forever, so the page holds the matches rather
 * than the whole history. security_invoker on the view keeps the existing rule:
 * owner and general manager cross-site, a site manager their own site.
 */
export async function fetchAllAnalyses(
  opts: { q?: string; limit?: number } = {},
): Promise<RawAnalysisRow[]> {
  const supabase = await createClient();
  const term = (opts.q ?? "").trim().replace(/[,()*%]/g, "");

  let query = supabase
    .from("xrf_analyses")
    .select(`
      line_id, visit_id, recorded_at, supplier_name, site_name, material_name,
      result, qc_weight_kg, unit_price, price_agreed, visit_state,
      settlement_status, unsettled_reason, gate_pass_id
    `)
    .order("recorded_at", { ascending: false })
    .limit(opts.limit ?? 400);

  if (term) {
    query = query.or(
      `material_name.ilike.%${term}%,supplier_name.ilike.%${term}%,site_name.ilike.%${term}%,result.ilike.%${term}%`,
    );
  }

  const { data } = await query;

  return (data ?? []).map((r) => ({
    lineId: (r.line_id as string) ?? "",
    visitId: (r.visit_id as string) ?? "",
    date: r.recorded_at as string,
    supplier: (r.supplier_name as string) ?? "—",
    site: (r.site_name as string) ?? "—",
    material: (r.material_name as string) ?? "—",
    result: (r.result as string | null) ?? null,
    qcWeight: r.qc_weight_kg != null ? Number(r.qc_weight_kg) : null,
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    priceAgreed: Boolean(r.price_agreed),
    state: (r.visit_state as string) ?? "",
    settlementStatus: (r.settlement_status as string) ?? "settled",
    unsettledReason: (r.unsettled_reason as string | null) ?? null,
    gatePassId: (r.gate_pass_id as string | null) ?? null,
  }));
}
