import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfVisitData } from "../fetch-data";
import { formatTs, formatKg } from "../format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={shared.row}>
      <Text style={shared.label}>{label}</Text>
      <Text style={shared.value}>{value}</Text>
    </View>
  );
}

export function AnalysisReportPdf({ data, docId }: { data: PdfVisitData; docId: string }) {
  const an = data.analysis;
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Analysis Report — ${data.id.slice(0, 8)}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Analysis Report" />
        <Text style={shared.docTitle}>Analysis Report</Text>
        <Text style={shared.docSubtitle}>
          Visit {data.id} · Supplier: {data.supplier_name ?? "—"}
        </Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Sample</Text>
            <Row label="Material"  value={data.material_type_name ?? "—"} />
            <Row label="Sample ID" value={an?.sample_id ?? "—"} />
            <Row label="Site"      value={data.site_name ?? "—"} />
          </View>

          {an ? (
            <>
              <View style={[shared.highlight, { marginBottom: 14 }]}>
                <View style={shared.highlightRow}>
                  <View>
                    <Text style={shared.label}>Output weight</Text>
                    <Text style={[shared.bold, { fontSize: 14, marginTop: 2 }]}>{formatKg(an.weight)}</Text>
                  </View>
                  <View>
                    <Text style={shared.label}>Grade</Text>
                    <Text style={[shared.bold, { fontSize: 14, marginTop: 2 }]}>{an.grade ?? "—"}</Text>
                  </View>
                  {an.purity != null && (
                    <View>
                      <Text style={shared.label}>Purity</Text>
                      <Text style={[shared.bold, { fontSize: 14, marginTop: 2 }]}>{an.purity}%</Text>
                    </View>
                  )}
                </View>
              </View>

              {an.qc_observations && (
                <View style={shared.section}>
                  <Text style={shared.sectionTitle}>QC observations</Text>
                  <Text style={{ fontSize: 9 }}>{an.qc_observations}</Text>
                </View>
              )}

              {an.xrf_result && (
                <View style={shared.section}>
                  <Text style={shared.sectionTitle}>XRF readings</Text>
                  <Text style={{ fontSize: 8, color: "#555", fontFamily: "Helvetica" }}>
                    {JSON.stringify(an.xrf_result, null, 2)}
                  </Text>
                </View>
              )}

              <View style={shared.section}>
                <Text style={shared.sectionTitle}>Analyst</Text>
                <Row label="Recorded by" value={an.recorded_by_name ?? "—"} />
                <Row label="Analyzed at" value={formatTs(an.analyzed_at)} />
              </View>
            </>
          ) : (
            <Text style={{ fontSize: 9, color: "#999" }}>No analysis record found.</Text>
          )}
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
