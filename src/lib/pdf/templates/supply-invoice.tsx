import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfSupplyInvoiceData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

export function SupplyInvoicePdf({ data, docId }: { data: PdfSupplyInvoiceData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Supply Invoice — ${data.visit_id.slice(0, 8)}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Supply Invoice" />
        <Text style={shared.docTitle}>Supply Invoice</Text>
        <Text style={shared.docSubtitle}>
          {data.supplier_name ?? "—"}{data.supplier_code ? ` · ${data.supplier_code}` : ""} · {formatTs(data.created_at)}
          {data.status ? ` · ${data.status.toUpperCase()}` : ""}
        </Text>

        <View style={shared.body}>
          {/* Materials supplied */}
          <View style={shared.table}>
            <View style={shared.tableHeader}>
              <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Material</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Weight (kg)</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Price ₦/kg</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1.3, textAlign: "right" }]}>Amount ₦</Text>
            </View>
            {data.items.map((it, i) => (
              <View style={shared.tableRow} key={i}>
                <Text style={{ flex: 2 }}>{it.material_name ?? "—"}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{formatKg(it.weight_kg)}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{it.unit_price != null ? formatNgn(it.unit_price) : "—"}</Text>
                <Text style={{ flex: 1.3, textAlign: "right" }}>{formatNgn(it.amount)}</Text>
              </View>
            ))}
          </View>

          {/* Settlement breakdown */}
          <View style={[shared.section, { marginTop: 14 }]}>
            <View style={shared.row}><Text style={shared.label}>Materials total</Text><Text style={shared.value}>{formatNgn(data.materials_total)}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Light bill / processing fee</Text><Text style={shared.value}>− {formatNgn(data.light_bill_total)}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Advance deducted</Text><Text style={shared.value}>− {formatNgn(data.advance_deducted)}</Text></View>
          </View>

          <View style={shared.highlight}>
            <Text style={shared.label}>Net balance payable</Text>
            <Text style={[shared.bold, { fontSize: 16, marginTop: 2 }]}>{formatNgn(data.net_balance)}</Text>
          </View>

          <View style={[shared.section, { marginTop: 10 }]}>
            <View style={shared.row}>
              <Text style={shared.label}>Remaining advance debt</Text>
              <Text style={shared.value}>{data.remaining_debt > 0 ? formatNgn(data.remaining_debt) : "₦0 (cleared)"}</Text>
            </View>
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
