import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfUtilityData } from "../fetch-data";
import { formatTs, formatNgn } from "../format";

export function UtilityInvoicePdf({ data, docId }: { data: PdfUtilityData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Processing Invoice — ${data.visit_id.slice(0, 8)}`}>
      <Page size="A5" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Processing Invoice" />
        <Text style={shared.docTitle}>Processing Invoice</Text>
        <Text style={shared.docSubtitle}>
          Visit {data.visit_id} · {formatTs(data.created_at)}
        </Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Customer</Text>
            <View style={shared.row}><Text style={shared.label}>Name</Text><Text style={shared.value}>{data.supplier_name ?? "—"}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Supplier ID</Text><Text style={shared.value}>{data.supplier_code ?? "—"}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Site</Text><Text style={shared.value}>{data.site_name ?? "—"}</Text></View>
          </View>

          {data.machines.length > 0 && (
            <View style={shared.section}>
              <Text style={shared.sectionTitle}>Machine usage</Text>
              <View style={shared.table}>
                <View style={shared.tableHeader}>
                  <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Machine</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 1 }]}>Basis</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Qty</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Rate</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 1.2, textAlign: "right" }]}>Cost</Text>
                </View>
                {data.machines.map((m, i) => (
                  <View style={shared.tableRow} key={i}>
                    <Text style={{ flex: 2 }}>{m.machine_name}</Text>
                    <Text style={{ flex: 1 }}>{m.charge_basis}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{`${m.measurement}`}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{formatNgn(m.rate)}</Text>
                    <Text style={{ flex: 1.2, textAlign: "right" }}>{formatNgn(m.line_cost)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={shared.section}>
            <View style={shared.row}>
              <Text style={shared.label}>Processing fee</Text>
              <Text style={shared.value}>{formatNgn(data.processing_fee_total)}</Text>
            </View>
          </View>

          {/* Any "other" charge is a separate deduction, itemised by its own type
              (description) rather than folded into the processing fee. */}
          {data.other_charges.length > 0 && (
            <View style={shared.section}>
              <Text style={shared.sectionTitle}>Other charges</Text>
              <View style={shared.table}>
                <View style={shared.tableHeader}>
                  <Text style={[shared.tableHeaderCell, { flex: 3 }]}>Type</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Amount</Text>
                </View>
                {data.other_charges.map((c, i) => (
                  <View style={shared.tableRow} key={i}>
                    <Text style={{ flex: 3 }}>{c.description}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{formatNgn(c.amount)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={shared.highlight}>
            <Text style={shared.label}>Total due</Text>
            <Text style={[shared.bold, { fontSize: 16, marginTop: 2 }]}>{formatNgn(data.grand_total)}</Text>
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
