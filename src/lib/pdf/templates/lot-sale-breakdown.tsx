import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfLotSaleData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

export function LotSaleBreakdownPdf({ data, docId }: { data: PdfLotSaleData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Bulk Sale Breakdown — ${data.id.slice(0, 8)}`}>
      <Page size="A5" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Bulk Sale Breakdown" />
        <Text style={shared.docTitle}>Bulk Sale Material: {data.material_type_name ?? "—"}</Text>
        <Text style={shared.docSubtitle}>
          Buyer: {data.buyer_name}{data.buyer_phone ? ` · ${data.buyer_phone}` : ""} · {formatTs(data.created_at)}
        </Text>

        <View style={shared.body}>
          {/* Supplier breakdown table */}
          <View style={shared.table}>
            <View style={shared.tableHeader}>
              <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Supplier</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Weight (kg)</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Price (₦)</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1.3, textAlign: "right" }]}>Total (₦)</Text>
            </View>
            {data.items.map((it, i) => (
              <View style={shared.tableRow} key={i}>
                <Text style={{ flex: 2 }}>{it.supplier_name ?? "—"}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{formatKg(it.weight_kg)}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{formatNgn(it.cost_price_per_kg)}</Text>
                <Text style={{ flex: 1.3, textAlign: "right" }}>{formatNgn(it.total)}</Text>
              </View>
            ))}
            <View style={[shared.tableRow, shared.bold]}>
              <Text style={{ flex: 2 }}>TOTAL</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{formatKg(data.total_weight_kg)}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>—</Text>
              <Text style={{ flex: 1.3, textAlign: "right" }}>{formatNgn(data.total_cost_price)}</Text>
            </View>
          </View>

          {/* Cost price computation */}
          <View style={[shared.highlight, { marginTop: 14, marginBottom: 14 }]}>
            <Text style={shared.label}>Average cost price per kg</Text>
            <Text style={[shared.bold, { fontSize: 16, marginTop: 2 }]}>
              {formatNgn(data.total_cost_price)} ÷ {formatKg(data.total_weight_kg)} = {formatNgn(data.avg_cost_price_per_kg)}/kg
            </Text>
          </View>

          {/* Inventory update */}
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Inventory update</Text>
            {data.items.map((it, i) => (
              <Text key={i} style={shared.value}>
                [x] {it.supplier_name ?? "—"} lot — {formatKg(it.weight_kg)} (SOLD)
              </Text>
            ))}
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Approval</Text>
            <View style={shared.row}><Text style={shared.label}>Status</Text><Text style={shared.value}>{data.approval_status.toUpperCase()}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Approved by</Text><Text style={shared.value}>{data.approved_by_name ?? "—"}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Approved at</Text><Text style={shared.value}>{formatTs(data.approved_at)}</Text></View>
            <View style={shared.row}><Text style={shared.label}>Site</Text><Text style={shared.value}>{data.site_name ?? "—"}</Text></View>
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
