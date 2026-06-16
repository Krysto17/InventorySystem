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

export function ProcessingReportPdf({ data, docId }: { data: PdfVisitData; docId: string }) {
  const pr = data.processing;
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Processing Report — ${data.id.slice(0, 8)}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Processing Report" />
        <Text style={shared.docTitle}>Processing Report</Text>
        <Text style={shared.docSubtitle}>
          Visit {data.id} · Supplier: {data.supplier_name ?? "—"}
        </Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Visit</Text>
            <Row label="Material"   value={data.material_type_name ?? "—"} />
            <Row label="Site"       value={data.site_name ?? "—"} />
            <Row label="Intake"     value={formatTs(data.created_at)} />
          </View>

          {pr ? (
            <>
              <View style={shared.section}>
                <Text style={shared.sectionTitle}>Machine usage</Text>
                <View style={shared.table}>
                  <View style={shared.tableHeader}>
                    <Text style={[shared.tableHeaderCell, { flex: 3 }]}>Machine</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Measurement</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Rate</Text>
                    <Text style={[shared.tableHeaderCell, { flex: 2, textAlign: "right" }]}>Line cost</Text>
                  </View>
                  {pr.usage.map((u, i) => (
                    <View key={i} style={shared.tableRow}>
                      <Text style={{ flex: 3, fontSize: 9 }}>{u.machine_name}</Text>
                      <Text style={{ flex: 2, fontSize: 9 }}>{u.measurement} {u.charge_basis}</Text>
                      <Text style={{ flex: 2, fontSize: 9 }}>{formatNgn(u.rate_snapshot)}</Text>
                      <Text style={{ flex: 2, fontSize: 9, textAlign: "right" }}>{formatNgn(u.line_cost)}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={shared.highlight}>
                <View style={shared.highlightRow}>
                  <Text style={shared.label}>Total processing fee</Text>
                  <Text style={[shared.bold, { fontSize: 12 }]}>{formatNgn(pr.total_fee)}</Text>
                </View>
                <Row label="Processed by"   value={pr.recorded_by_name ?? "—"} />
                <Row label="Completed"      value={formatTs(pr.completed_at)} />
              </View>
            </>
          ) : (
            <Text style={{ fontSize: 9, color: "#999" }}>No processing record found.</Text>
          )}
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
