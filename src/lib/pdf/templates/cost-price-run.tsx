import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfCostPriceData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

const statusLabel = (s: string | null) =>
  s === "approved" ? "Sold" : s === "pending" ? "Awaiting owner approval" : s === "rejected" ? "Rejected" : "Computation";

// Local, roomier styling on A4 so the breakdown reads clearly.
const s = StyleSheet.create({
  body: { paddingHorizontal: 28, paddingTop: 4 },
  headRow: { flexDirection: "row", borderBottomWidth: 1.2, borderBottomColor: "#333", paddingBottom: 5 },
  headCell: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#444", textTransform: "uppercase" },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: "#e2e2e2", paddingVertical: 7 },
  cell: { fontSize: 11 },
  totalRow: { flexDirection: "row", borderTopWidth: 1.4, borderTopColor: "#333", paddingVertical: 7, marginTop: 1 },
  totalCell: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  supplier: { flex: 3 },
  num: { flex: 1.4, textAlign: "right" },
  numWide: { flex: 1.7, textAlign: "right" },
  highlight: { marginTop: 20, backgroundColor: "#f4efe6", borderRadius: 3, padding: 14 },
  hLabel: { fontSize: 10, color: "#7a6a48", textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  hValue: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4, color: "#5b4a22" },
});

export function CostPriceRunPdf({ data, docId }: { data: PdfCostPriceData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Cost Price — ${data.label}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Cost Price Computation" />
        <Text style={shared.docTitle}>{data.label}</Text>
        <Text style={shared.docSubtitle}>
          {data.batch_code ? `${data.batch_code} · ` : ""}{data.material_type_name ?? "—"} · {statusLabel(data.approval_status)} · {formatTs(data.created_at)}
        </Text>

        <View style={s.body}>
          <View style={s.headRow}>
            <Text style={[s.headCell, s.supplier]}>Supplier / material</Text>
            <Text style={[s.headCell, s.num]}>Weight (kg)</Text>
            <Text style={[s.headCell, s.num]}>Cost ₦/kg</Text>
            <Text style={[s.headCell, s.numWide]}>Line cost ₦</Text>
          </View>
          {data.items.map((it, i) => (
            <View style={s.row} key={i}>
              <Text style={[s.cell, s.supplier]}>
                {it.external ? `${it.material_name ?? "—"} (external)` : (it.supplier_name ?? "—")}
              </Text>
              <Text style={[s.cell, s.num]}>{formatKg(it.weight_kg)}</Text>
              <Text style={[s.cell, s.num]}>{formatNgn(it.cost_price_per_kg)}</Text>
              <Text style={[s.cell, s.numWide]}>{formatNgn(it.total)}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={[s.totalCell, s.supplier]}>TOTAL</Text>
            <Text style={[s.totalCell, s.num]}>{formatKg(data.total_weight_kg)}</Text>
            <Text style={[s.totalCell, s.num]}>—</Text>
            <Text style={[s.totalCell, s.numWide]}>{formatNgn(data.total_cost_price)}</Text>
          </View>

          <View style={s.highlight}>
            <Text style={s.hLabel}>Cost price</Text>
            <Text style={s.hValue}>{formatNgn(data.avg_cost_price_per_kg)} / kg</Text>
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
