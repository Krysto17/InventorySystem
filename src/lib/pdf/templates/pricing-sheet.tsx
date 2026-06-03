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

export function PricingSheetPdf({ data, docId }: { data: PdfVisitData; docId: string }) {
  const pr = data.pricing;
  const an = data.analysis;
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Pricing Sheet — ${data.id.slice(0, 8)}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Pricing / Agreement Sheet" />
        <Text style={shared.docTitle}>Pricing &amp; Agreement Sheet</Text>
        <Text style={shared.docSubtitle}>
          Visit {data.id} · Supplier: {data.supplier_name ?? "—"}
        </Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Material</Text>
            <Row label="Type"   value={data.material_type_name ?? "—"} />
            <Row label="Weight" value={an ? formatKg(an.weight) : "—"} />
            <Row label="Grade"  value={an?.grade ?? "—"} />
          </View>

          {pr ? (
            <>
              <View style={[shared.highlight, { marginBottom: 14 }]}>
                <View style={shared.highlightRow}>
                  <View>
                    <Text style={shared.label}>Unit price</Text>
                    <Text style={[shared.bold, { fontSize: 13, marginTop: 2 }]}>
                      {formatNgn(pr.unit_price)}/kg
                    </Text>
                  </View>
                  <View>
                    <Text style={shared.label}>Purchase amount</Text>
                    <Text style={[shared.bold, { fontSize: 13, marginTop: 2 }]}>
                      {formatNgn(pr.purchase_amount)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={shared.section}>
                <Text style={shared.sectionTitle}>Agreement</Text>
                <Row label="Status"        value={pr.agreement_status.replace("_", " ").toUpperCase()} />
                <Row label="Payment terms" value={pr.payment_terms ?? "—"} />
              </View>

              <View style={shared.section}>
                <Text style={shared.sectionTitle}>Authorisation</Text>
                <Row label="Priced by"    value={pr.priced_by_name ?? "—"} />
                {pr.overridden_by_name && (
                  <Row label="Overridden by" value={pr.overridden_by_name} />
                )}
              </View>
            </>
          ) : (
            <Text style={{ fontSize: 9, color: "#999" }}>No pricing record found.</Text>
          )}
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
