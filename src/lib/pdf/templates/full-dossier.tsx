import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfVisitData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={shared.row}>
      <Text style={shared.label}>{label}</Text>
      <Text style={shared.value}>{value}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={shared.sectionTitle}>{children}</Text>;
}

export function FullDossierPdf({ data, docId }: { data: PdfVisitData; docId: string }) {
  const generatedAt = new Date().toISOString();
  const pr = data.processing;
  const an = data.analysis;
  const pricing = data.pricing;
  const processingPaid  = data.payments.filter((p) => p.direction === "processing_fee_in").reduce((s, p) => s + p.amount, 0);
  const purchasePaid    = data.payments.filter((p) => p.direction === "purchase_amount_out").reduce((s, p) => s + p.amount, 0);

  return (
    <Document title={`Visit Dossier — ${data.id.slice(0, 8)}`}>
      {/* ── Page 1: Visit Details + Processing + Analysis ─────────────────── */}
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Full Visit Dossier" />
        <Text style={shared.docTitle}>Visit Dossier</Text>
        <Text style={shared.docSubtitle}>
          Visit {data.id} · Supplier: {data.supplier_name ?? "—"} · {formatTs(data.created_at)}
        </Text>

        <View style={shared.body}>
          {/* Visit details */}
          <View style={shared.section}>
            <SectionTitle>1. Visit Details</SectionTitle>
            <Row label="Supplier"       value={data.supplier_name ?? "—"} />
            <Row label="Phone"          value={data.supplier_phone ?? "—"} />
            <Row label="Material"       value={data.material_type_name ?? "—"} />
            <Row label="Entry path"     value={data.entry_path} />
            <Row label="Opened"         value={formatTs(data.created_at)} />
            <Row label="Recorded by"    value={data.created_by_name ?? "—"} />
          </View>

          {/* Processing */}
          <View style={shared.section}>
            <SectionTitle>2. Processing</SectionTitle>
            {pr ? (
              <>
                <View style={shared.table}>
                  <View style={shared.tableHeader}>
                    <Text style={[shared.tableHeaderCell, { flex: 3 }]}>Machine</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Qty</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Rate</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2, textAlign: "right" }]}>Cost</Text>
                  </View>
                  {pr.usage.map((u, i) => (
                    <View key={i} style={shared.tableRow}>
                      <Text style={{ flex: 3, fontSize: 8 }}>{u.machine_name}</Text>
                      <Text style={{ flex: 2, fontSize: 8 }}>{u.measurement} {u.charge_basis}</Text>
                      <Text style={{ flex: 2, fontSize: 8 }}>{formatNgn(u.rate_snapshot)}</Text>
                      <Text style={{ flex: 2, fontSize: 8, textAlign: "right" }}>{formatNgn(u.line_cost)}</Text>
                    </View>
                  ))}
                </View>
                <Row label="Total fee"   value={formatNgn(pr.total_fee)} />
                <Row label="Processed by" value={pr.recorded_by_name ?? "—"} />
              </>
            ) : (
              <Text style={{ fontSize: 8, color: "#999" }}>No processing record (pre-processed entry).</Text>
            )}
          </View>

          {/* Analysis */}
          <View style={shared.section}>
            <SectionTitle>3. Analysis</SectionTitle>
            {an ? (
              <>
                <Row label="Weight"    value={formatKg(an.weight)} />
                <Row label="Grade"     value={an.grade ?? "—"} />
                {an.purity != null && <Row label="Purity" value={`${an.purity}%`} />}
                <Row label="Sample ID" value={an.sample_id ?? "—"} />
                {an.qc_observations && <Row label="QC notes" value={an.qc_observations} />}
                <Row label="Analyst"   value={an.recorded_by_name ?? "—"} />
              </>
            ) : (
              <Text style={{ fontSize: 8, color: "#999" }}>No analysis record.</Text>
            )}
          </View>
        </View>
        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>

      {/* ── Page 2: Pricing + Payments ───────────────────────────────────── */}
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Full Visit Dossier (continued)" />
        <View style={[shared.body, { paddingTop: 24 }]}>
          {/* Pricing */}
          <View style={shared.section}>
            <SectionTitle>4. Pricing &amp; Agreement</SectionTitle>
            {pricing ? (
              <>
                <Row label="Unit price"     value={`${formatNgn(pricing.unit_price)}/kg`} />
                <Row label="Purchase total" value={formatNgn(pricing.purchase_amount)} />
                <Row label="Agreement"      value={pricing.agreement_status.replace("_", " ").toUpperCase()} />
                <Row label="Payment terms"  value={pricing.payment_terms ?? "—"} />
                <Row label="Priced by"      value={pricing.priced_by_name ?? "—"} />
                {pricing.overridden_by_name && (
                  <Row label="Overridden by" value={pricing.overridden_by_name} />
                )}
              </>
            ) : (
              <Text style={{ fontSize: 8, color: "#999" }}>No pricing record.</Text>
            )}
          </View>

          {/* Payments */}
          <View style={shared.section}>
            <SectionTitle>5. Payments</SectionTitle>
            {data.payments.length === 0 ? (
              <Text style={{ fontSize: 8, color: "#999" }}>No payments recorded.</Text>
            ) : (
              <>
                <View style={shared.table}>
                  <View style={shared.tableHeader}>
                    <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Date</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 3 }]}>Direction</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Method</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2, textAlign: "right" }]}>Amount</Text>
                  </View>
                  {data.payments.map((p) => (
                    <View key={p.id} style={shared.tableRow}>
                      <Text style={{ flex: 2, fontSize: 8 }}>{formatTs(p.paid_at)}</Text>
                      <Text style={{ flex: 3, fontSize: 8 }}>
                        {p.direction === "processing_fee_in" ? "Fee in" : "Purchase out"}
                      </Text>
                      <Text style={{ flex: 2, fontSize: 8 }}>{p.method ?? "—"}</Text>
                      <Text style={{ flex: 2, fontSize: 8, textAlign: "right" }}>{formatNgn(p.amount)}</Text>
                    </View>
                  ))}
                </View>
                {data.processing_deducted && (
                  <Text style={{ fontSize: 8, color: "#555", marginTop: 4 }}>
                    * Processing fee deducted from purchase amount
                  </Text>
                )}
                <View style={{ marginTop: 8 }}>
                  <Row label="Processing paid" value={formatNgn(processingPaid)} />
                  <Row label="Purchase paid"   value={formatNgn(purchasePaid)} />
                </View>
              </>
            )}
          </View>
        </View>
        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>

      {/* ── Page 3: Audit trail ──────────────────────────────────────────── */}
      {data.events.length > 0 && (
        <Page size="A4" style={shared.page}>
          <BrandHeader siteName={data.site_name} docType="Full Visit Dossier — Audit Trail" />
          <View style={[shared.body, { paddingTop: 24 }]}>
            <View style={shared.section}>
              <SectionTitle>{`6. Audit Trail (${data.events.length} events)`}</SectionTitle>
              <View style={shared.table}>
                <View style={shared.tableHeader}>
                  <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Time</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Event</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Actor</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 3 }]}>Detail</Text>
                </View>
                {data.events.map((e, i) => (
                  <View key={i} style={shared.tableRow}>
                    <Text style={{ flex: 2, fontSize: 7 }}>{formatTs(e.created_at)}</Text>
                    <Text style={{ flex: 2, fontSize: 7 }}>{e.event_type.replace(/_/g, " ")}</Text>
                    <Text style={{ flex: 2, fontSize: 7 }}>{e.actor_name ?? "system"}</Text>
                    <Text style={{ flex: 3, fontSize: 7, color: "#555" }}>
                      {e.payload && Object.keys(e.payload).length > 0
                        ? JSON.stringify(e.payload).slice(0, 80)
                        : "—"}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <PageFooter docId={docId} generatedAt={generatedAt} />
        </Page>
      )}
    </Document>
  );
}
