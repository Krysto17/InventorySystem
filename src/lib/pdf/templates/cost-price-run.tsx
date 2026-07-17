import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfCostPriceData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

const statusLabel = (s: string | null) =>
  s === "approved" ? "Sold" : s === "pending" ? "Awaiting owner approval" : s === "rejected" ? "Rejected" : "Computation";

export function CostPriceRunPdf({ data, docId }: { data: PdfCostPriceData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Cost Price — ${data.label}`}>
      <Page size="A5" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Cost Price Computation" />
        <Text style={shared.docTitle}>{data.label}</Text>
        <Text style={shared.docSubtitle}>
          {data.batch_code ? `${data.batch_code} · ` : ""}{data.material_type_name ?? "—"} · {statusLabel(data.approval_status)} · {formatTs(data.created_at)}
        </Text>

        <View style={shared.body}>
          <View style={shared.table}>
            <View style={shared.tableHeader}>
              <Text style={[shared.tableHeaderCell, { flex: 1.4 }]}>Material</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1.6 }]}>Supplier</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>Weight (kg)</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1, textAlign: "right" }]}>₦/kg</Text>
              <Text style={[shared.tableHeaderCell, { flex: 1.3, textAlign: "right" }]}>Line cost (₦)</Text>
            </View>
            {data.items.map((it, i) => (
              <View style={shared.tableRow} key={i}>
                <Text style={{ flex: 1.4 }}>{it.material_name ?? "—"}</Text>
                <Text style={{ flex: 1.6 }}>{it.supplier_name ?? "—"}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{formatKg(it.weight_kg)}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{formatNgn(it.cost_price_per_kg)}</Text>
                <Text style={{ flex: 1.3, textAlign: "right" }}>{formatNgn(it.total)}</Text>
              </View>
            ))}
            <View style={[shared.tableRow, shared.bold]}>
              <Text style={{ flex: 3 }}>TOTAL</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{formatKg(data.total_weight_kg)}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>—</Text>
              <Text style={{ flex: 1.3, textAlign: "right" }}>{formatNgn(data.total_cost_price)}</Text>
            </View>
          </View>

          <View style={[shared.highlight, { marginTop: 14 }]}>
            <Text style={shared.label}>Weighted cost price</Text>
            <Text style={[shared.bold, { fontSize: 16, marginTop: 2 }]}>
              {formatNgn(data.total_cost_price)} ÷ {formatKg(data.total_weight_kg)} = {formatNgn(data.avg_cost_price_per_kg)}/kg
            </Text>
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
