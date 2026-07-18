import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fetchVisitPdfData, fetchBulkSalePdfData, fetchLotSalePdfData, fetchUtilityInvoiceData, fetchSupplyInvoiceData, fetchPriceSlipData, fetchCostPriceRunData, fetchGatePassData } from "@/lib/pdf/fetch-data";
import { PriceSlipPdf } from "@/lib/pdf/templates/price-slip";
import { CostPriceRunPdf } from "@/lib/pdf/templates/cost-price-run";
import { GatePassPdf } from "@/lib/pdf/templates/gate-pass";
import { LotSaleBreakdownPdf } from "@/lib/pdf/templates/lot-sale-breakdown";
import { UtilityInvoicePdf } from "@/lib/pdf/templates/utility-invoice";
import { SupplyInvoicePdf } from "@/lib/pdf/templates/supply-invoice";
import { ProcessingReportPdf } from "@/lib/pdf/templates/processing-report";
import { AnalysisReportPdf }   from "@/lib/pdf/templates/analysis-report";
import { PricingSheetPdf }     from "@/lib/pdf/templates/pricing-sheet";
import { PaymentStatementPdf } from "@/lib/pdf/templates/payment-statement";
import { BulkSaleReceiptPdf }  from "@/lib/pdf/templates/bulk-sale-receipt";
import { FullDossierPdf }      from "@/lib/pdf/templates/full-dossier";
import { createHash } from "crypto";
import type { DocumentProps } from "@react-pdf/renderer";

export const runtime = "nodejs";

// renderToBuffer requires ReactElement<DocumentProps>; our templates return Document
// so we cast here rather than polluting every template with explicit return types.
function pdf<P extends object>(
  Component: React.ComponentType<P>,
  props: P,
): React.ReactElement<DocumentProps> {
  return React.createElement(Component, props) as unknown as React.ReactElement<DocumentProps>;
}

const VISIT_TYPES = ["processing", "analysis", "pricing", "payments", "dossier"] as const;
const BULK_TYPES  = ["bulk-sale"] as const;
type VisitPdfType = (typeof VISIT_TYPES)[number];
type BulkPdfType  = (typeof BULK_TYPES)[number];

function docHash(type: string, id: string): string {
  return createHash("sha256")
    .update(`${type}:${id}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function forbidden(msg = "Forbidden") {
  return NextResponse.json({ error: msg }, { status: 403 });
}

function notFound(msg = "Not found") {
  return NextResponse.json({ error: msg }, { status: 404 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  // ── Bulk sale receipt ────────────────────────────────────────────────────
  if (type === "bulk-sale") {
    if (me.role !== "inventory" && me.role !== "owner") return forbidden();

    const data = await fetchBulkSalePdfData(id);
    if (!data) return notFound("Bulk sale not found");

    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(BulkSaleReceiptPdf, { data, docId }));
    return pdfResponse(buffer, `bulk-sale-${id.slice(0, 8)}.pdf`);
  }

  // ── Material price slip (printed when a price is set) ─────────────────────
  if (type === "price-slip") {
    if (!["inventory", "manager", "owner", "receiving"].includes(me.role)) return forbidden();
    const data = await fetchPriceSlipData(id); // RLS-scoped read; null if not priced/visible
    if (!data) return notFound("Priced line not found");
    const slipFormat = _req.nextUrl.searchParams.get("format") === "thermal" ? "thermal" : "a5";
    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(PriceSlipPdf, { data, docId, format: slipFormat }));
    return pdfResponse(buffer, `price-slip-${slipFormat}-${data.receipt_no}.pdf`);
  }

  // ── Gate pass (materials leaving the yard) ────────────────────────────────
  if (type === "gate-pass") {
    if (!["manager", "owner", "gate", "receiving", "inventory"].includes(me.role)) return forbidden();
    const data = await fetchGatePassData(id); // RLS-scoped; null if not visible
    if (!data) return notFound("Gate pass not found");
    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(GatePassPdf, { data, docId }));
    return pdfResponse(buffer, `gate-pass-${id.slice(0, 8)}.pdf`);
  }

  // ── Cost-price computation / mixing batch ─────────────────────────────────
  if (type === "cost-price") {
    if (!["manager", "owner"].includes(me.role)) return forbidden();
    const data = await fetchCostPriceRunData(id); // RLS-scoped; null if not visible
    if (!data) return notFound("Cost-price run not found");
    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(CostPriceRunPdf, { data, docId }));
    return pdfResponse(buffer, `cost-price-${id.slice(0, 8)}.pdf`);
  }

  // ── Supply invoice (batch settlement) ─────────────────────────────────────
  if (type === "supply-invoice") {
    if (!["manager", "accounting", "owner"].includes(me.role)) return forbidden();

    const data = await fetchSupplyInvoiceData(id);
    if (!data) return notFound("Visit not found");

    const format = _req.nextUrl.searchParams.get("format") === "thermal" ? "thermal" : "a4";
    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(SupplyInvoicePdf, { data, docId, format }));
    return pdfResponse(buffer, `supply-invoice-${format}-${id.slice(0, 8)}.pdf`);
  }

  // ── Processing invoice (processing + manager only) ────────────────────────
  if (type === "utility") {
    if (!["processing", "manager", "owner"].includes(me.role)) return forbidden();
    const data = await fetchUtilityInvoiceData(id);
    if (!data) return notFound("Visit not found");

    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(UtilityInvoicePdf, { data, docId }));
    return pdfResponse(buffer, `utility-invoice-${id.slice(0, 8)}.pdf`);
  }

  // ── Lot-tracked bulk sale breakdown (Phase 9) ─────────────────────────────
  if (type === "lot-sale") {
    if (me.role !== "inventory" && me.role !== "owner") return forbidden();

    const data = await fetchLotSalePdfData(id);
    if (!data) return notFound("Lot sale not found");

    const docId = docHash(type, id);
    const buffer = await renderToBuffer(pdf(LotSaleBreakdownPdf, { data, docId }));
    return pdfResponse(buffer, `lot-sale-${id.slice(0, 8)}.pdf`);
  }

  // ── Visit-based PDFs ─────────────────────────────────────────────────────
  if (!VISIT_TYPES.includes(type as VisitPdfType)) {
    return NextResponse.json({ error: "Unknown PDF type" }, { status: 400 });
  }

  const data = await fetchVisitPdfData(id);
  if (!data) return notFound("Visit not found");

  // Role-based access control (mirrors screen access)
  const isOwner = me.role === "owner";

  // Verify user can see this visit (same-site or owner) — Supabase RLS already
  // filters fetchVisitPdfData via createClient(), but double-check for non-owner.
  if (!isOwner) {
    const supabase = await createClient();
    const { data: visit } = await supabase
      .from("visits")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!visit) return forbidden("You do not have access to this visit");
  }

  // Additional role restrictions for sensitive sections
  if (type === "pricing"  && me.role !== "manager"    && !isOwner) return forbidden("Pricing sheet: manager or owner only");
  if (type === "payments" && me.role !== "accounting" && !isOwner) return forbidden("Payment statement: accounting or owner only");
  if (type === "dossier"  && !isOwner)                              return forbidden("Full dossier: owner only");

  const docId = docHash(type, id);
  let buffer: Buffer;

  switch (type as VisitPdfType) {
    case "processing":
      buffer = await renderToBuffer(pdf(ProcessingReportPdf, { data, docId }));
      break;
    case "analysis":
      buffer = await renderToBuffer(pdf(AnalysisReportPdf, { data, docId }));
      break;
    case "pricing":
      buffer = await renderToBuffer(pdf(PricingSheetPdf, { data, docId }));
      break;
    case "payments":
      buffer = await renderToBuffer(pdf(PaymentStatementPdf, { data, docId }));
      break;
    case "dossier":
      buffer = await renderToBuffer(pdf(FullDossierPdf, { data, docId }));
      break;
  }

  return pdfResponse(buffer!, `${type}-${id.slice(0, 8)}.pdf`);
}

function pdfResponse(buffer: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
