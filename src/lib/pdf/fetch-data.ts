import "server-only";
import { createClient } from "@/lib/supabase/server";

// ─── Shared data types ────────────────────────────────────────────────────────

export type PdfVisitData = {
  id: string;
  state: string;
  entry_path: string;
  vehicle_plate: string | null;
  created_at: string;
  closed_at: string | null;
  site_name: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  material_type_name: string | null;
  created_by_name: string | null;
  processing: {
    recorded_by_name: string | null;
    completed_at: string | null;
    total_fee: number;
    usage: { machine_name: string; charge_basis: string; measurement: number; rate_snapshot: number; line_cost: number }[];
  } | null;
  analysis: {
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
    unit_price: number | null;
    purchase_amount: number | null;
    agreement_status: string;
    payment_terms: string | null;
    priced_by_name: string | null;
    overridden_by_name: string | null;
  } | null;
  payments: {
    id: string;
    direction: string;
    amount: number;
    method: string | null;
    notes: string | null;
    paid_at: string;
    recorded_by_name: string | null;
  }[];
  processing_deducted: boolean;
  events: {
    event_type: string;
    created_at: string;
    actor_name: string | null;
    payload: Record<string, unknown>;
  }[];
};

export type PdfBulkSaleData = {
  id: string;
  site_name: string | null;
  buyer_name: string;
  buyer_phone: string | null;
  material_type_name: string | null;
  grade: string | null;
  weight: number;
  unit_price: number;
  total: number;
  sold_at: string;
  approval_status: string;
  approved_at: string | null;
  approved_by_name: string | null;
  recorded_by_name: string | null;
};

// ─── Flatten Supabase array-relations ────────────────────────────────────────

function g1<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] ?? null) as T | null;
  return (v ?? null) as T | null;
}

function str(v: unknown): string | null {
  return v != null ? String(v) : null;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

// ─── Visit full data ──────────────────────────────────────────────────────────

export async function fetchVisitPdfData(visitId: string): Promise<PdfVisitData | null> {
  const supabase = await createClient();

  const { data: v } = await supabase
    .from("visits")
    .select(`
      id, state, entry_path, vehicle_plate, created_at, closed_at, processing_deducted,
      site:sites(name),
      supplier:suppliers(name, phone),
      declared_material_type:material_types(name),
      created_by_profile:profiles!visits_created_by_fkey(full_name)
    `)
    .eq("id", visitId)
    .single();

  if (!v) return null;

  const [prRes, anRes, pricingRes, pmtRes, evRes] = await Promise.all([
    supabase
      .from("processing_records")
      .select(`
        completed_at,
        recorded_by_profile:profiles!processing_records_recorded_by_fkey(full_name),
        usage:processing_machine_usage(measurement, rate_snapshot, line_cost, machine:machines(name, charge_basis))
      `)
      .eq("visit_id", visitId)
      .maybeSingle(),

    supabase
      .from("analysis_records")
      .select(`weight, grade, purity, sample_id, qc_observations, xrf_result, analyzed_at,
               recorded_by_profile:profiles!analysis_records_recorded_by_fkey(full_name)`)
      .eq("visit_id", visitId)
      .maybeSingle(),

    supabase
      .from("pricing")
      .select(`unit_price, purchase_amount, agreement_status, payment_terms,
               priced_by_profile:profiles!pricing_priced_by_fkey(full_name),
               overridden_by_profile:profiles!pricing_overridden_by_fkey(full_name)`)
      .eq("visit_id", visitId)
      .maybeSingle(),

    supabase
      .from("payments")
      .select(`id, direction, amount, method, notes, paid_at,
               recorded_by_profile:profiles!payments_recorded_by_fkey(full_name)`)
      .eq("visit_id", visitId)
      .order("paid_at", { ascending: true }),

    supabase
      .from("transaction_events")
      .select(`event_type, created_at, payload, actor:profiles!transaction_events_actor_id_fkey(full_name)`)
      .eq("visit_id", visitId)
      .order("created_at", { ascending: true }),
  ]);

  const pr = prRes.data;
  const an = anRes.data;
  const pricing = pricingRes.data;
  const payments = pmtRes.data ?? [];
  const events = evRes.data ?? [];

  return {
    id: v.id as string,
    state: v.state as string,
    entry_path: v.entry_path as string,
    vehicle_plate: str(v.vehicle_plate),
    created_at: v.created_at as string,
    closed_at: str(v.closed_at),
    processing_deducted: !!(v as { processing_deducted?: boolean }).processing_deducted,
    site_name: g1<{ name: string }>(v.site)?.name ?? null,
    supplier_name: g1<{ name: string }>(v.supplier)?.name ?? null,
    supplier_phone: g1<{ phone: string | null }>(v.supplier)?.phone ?? null,
    material_type_name: g1<{ name: string }>(v.declared_material_type)?.name ?? null,
    created_by_name: g1<{ full_name: string }>(v.created_by_profile)?.full_name ?? null,

    processing: pr
      ? {
          recorded_by_name: g1<{ full_name: string }>((pr as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? null,
          completed_at: str(pr.completed_at),
          usage: ((pr as { usage: unknown[] }).usage ?? []).map((u) => {
            const row = u as { machine: unknown; measurement: number; rate_snapshot: number; line_cost: number };
            const m = g1<{ name: string; charge_basis: string }>(row.machine) ?? { name: "—", charge_basis: "—" };
            return { machine_name: m.name, charge_basis: m.charge_basis, measurement: num(row.measurement), rate_snapshot: num(row.rate_snapshot), line_cost: num(row.line_cost) };
          }),
          total_fee: ((pr as { usage: { line_cost: number }[] }).usage ?? []).reduce((s, u) => s + num(u.line_cost), 0),
        }
      : null,

    analysis: an
      ? {
          weight: num(an.weight),
          grade: str(an.grade),
          purity: an.purity != null ? num(an.purity) : null,
          sample_id: str(an.sample_id),
          qc_observations: str(an.qc_observations),
          xrf_result: an.xrf_result,
          recorded_by_name: g1<{ full_name: string }>((an as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? null,
          analyzed_at: str(an.analyzed_at),
        }
      : null,

    pricing: pricing
      ? {
          unit_price: pricing.unit_price != null ? num(pricing.unit_price) : null,
          purchase_amount: pricing.purchase_amount != null ? num(pricing.purchase_amount) : null,
          agreement_status: pricing.agreement_status as string,
          payment_terms: str(pricing.payment_terms),
          priced_by_name: g1<{ full_name: string }>((pricing as { priced_by_profile: unknown }).priced_by_profile)?.full_name ?? null,
          overridden_by_name: g1<{ full_name: string }>((pricing as { overridden_by_profile: unknown }).overridden_by_profile)?.full_name ?? null,
        }
      : null,

    payments: payments.map((p) => ({
      id: p.id as string,
      direction: p.direction as string,
      amount: num(p.amount),
      method: str(p.method),
      notes: str(p.notes),
      paid_at: p.paid_at as string,
      recorded_by_name: g1<{ full_name: string }>((p as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? null,
    })),

    events: events.map((e) => ({
      event_type: e.event_type as string,
      created_at: e.created_at as string,
      actor_name: g1<{ full_name: string }>((e as { actor: unknown }).actor)?.full_name ?? null,
      payload: (e.payload ?? {}) as Record<string, unknown>,
    })),
  };
}

// ─── Bulk sale data ───────────────────────────────────────────────────────────

export async function fetchBulkSalePdfData(saleId: string): Promise<PdfBulkSaleData | null> {
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("bulk_sales")
    .select(`
      id, buyer_name, buyer_phone, grade, weight, unit_price, total, sold_at,
      approval_status, approved_at,
      site:sites(name),
      material_type:material_types(name),
      recorded_by_profile:profiles!bulk_sales_recorded_by_fkey(full_name),
      approved_by_profile:profiles!bulk_sales_approved_by_fkey(full_name)
    `)
    .eq("id", saleId)
    .single();

  if (!s) return null;

  return {
    id: s.id as string,
    site_name: g1<{ name: string }>(s.site)?.name ?? null,
    buyer_name: s.buyer_name as string,
    buyer_phone: str(s.buyer_phone),
    material_type_name: g1<{ name: string }>(s.material_type)?.name ?? null,
    grade: str(s.grade),
    weight: num(s.weight),
    unit_price: num(s.unit_price),
    total: num(s.total),
    sold_at: s.sold_at as string,
    approval_status: s.approval_status as string,
    approved_at: str(s.approved_at),
    approved_by_name: g1<{ full_name: string }>((s as { approved_by_profile: unknown }).approved_by_profile)?.full_name ?? null,
    recorded_by_name: g1<{ full_name: string }>((s as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? null,
  };
}
