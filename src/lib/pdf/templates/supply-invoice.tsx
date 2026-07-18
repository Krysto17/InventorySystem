import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfSupplyInvoiceData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

export type InvoiceFormat = "a4" | "thermal";

// ─── A4 (full page) ──────────────────────────────────────────────────────────
function A4Invoice({ data, docId }: { data: PdfSupplyInvoiceData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Page size="A4" style={shared.page}>
      <BrandHeader siteName={data.site_name} docType="Supply Invoice" />
      <Text style={shared.docTitle}>Supply Invoice</Text>
      <Text style={shared.docSubtitle}>
        {data.supplier_name ?? "—"}{data.supplier_code ? ` · ${data.supplier_code}` : ""} · {formatTs(data.created_at)}
        {data.status ? ` · ${data.status.toUpperCase()}` : ""}
      </Text>

      <View style={shared.body}>
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

        <View style={[shared.section, { marginTop: 14 }]}>
          <View style={shared.row}><Text style={shared.label}>Materials total</Text><Text style={shared.value}>{formatNgn(data.materials_total)}</Text></View>
          <View style={shared.row}><Text style={shared.label}>Processing fee</Text><Text style={shared.value}>− {formatNgn(data.light_bill_total)}</Text></View>
          {data.other_deductions.map((d, i) => (
            <View style={shared.row} key={i}><Text style={shared.label}>{d.label}</Text><Text style={shared.value}>− {formatNgn(d.amount)}</Text></View>
          ))}
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
  );
}

// ─── 80mm thermal receipt ─────────────────────────────────────────────────────
const W = 226.77; // 80mm
const t = StyleSheet.create({
  page: { width: W, paddingHorizontal: 8, paddingVertical: 10, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  company: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", letterSpacing: 0.3 },
  rc: { fontSize: 7, textAlign: "center", marginTop: 1 },
  title: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3 },
  sub: { fontSize: 7.5, textAlign: "center", marginTop: 1, color: "#333" },
  hr: { borderBottomWidth: 1, borderBottomColor: "#000", borderStyle: "dashed", marginVertical: 6 },
  sectionLbl: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  lbl: { fontFamily: "Helvetica-Bold" },
  val: { textAlign: "right", marginLeft: 6 },
  itemName: { flex: 1, fontFamily: "Helvetica-Bold" },
  itemSub: { fontSize: 7, color: "#444", marginBottom: 3 },
  netLbl: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 2 },
  net: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginVertical: 3 },
  foot: { fontSize: 7, textAlign: "center", marginTop: 6, color: "#333" },
});

function ThermalInvoice({ data, docId }: { data: PdfSupplyInvoiceData; docId: string }) {
  return (
    <Page size={[W, 520]} style={t.page}>
      <Text style={t.company}>MAGNETIC JOEZION NIG. LTD</Text>
      <Text style={t.rc}>RC: 1966608</Text>
      <Text style={t.title}>SUPPLY INVOICE</Text>
      <Text style={t.sub}>{data.supplier_name ?? "—"}{data.supplier_code ? ` · ${data.supplier_code}` : ""}</Text>
      <Text style={t.sub}>{formatTs(data.created_at)}{data.status ? ` · ${data.status.toUpperCase()}` : ""}</Text>

      <View style={t.hr} />
      <Text style={t.sectionLbl}>MATERIALS</Text>
      {data.items.map((it, i) => (
        <View key={i} wrap={false}>
          <View style={t.row}>
            <Text style={t.itemName}>{it.material_name ?? "—"}</Text>
            <Text style={t.val}>{formatNgn(it.amount)}</Text>
          </View>
          <Text style={t.itemSub}>{formatKg(it.weight_kg)}{it.unit_price != null ? ` @ ${formatNgn(it.unit_price)}/kg` : ""}</Text>
        </View>
      ))}

      <View style={t.hr} />
      <View style={t.row}><Text style={t.lbl}>Materials total</Text><Text style={t.val}>{formatNgn(data.materials_total)}</Text></View>
      <View style={t.row}><Text>Processing fee</Text><Text style={t.val}>− {formatNgn(data.light_bill_total)}</Text></View>
      {data.other_deductions.map((d, i) => (
        <View style={t.row} key={i}><Text>{d.label}</Text><Text style={t.val}>− {formatNgn(d.amount)}</Text></View>
      ))}
      <View style={t.row}><Text>Advance deducted</Text><Text style={t.val}>− {formatNgn(data.advance_deducted)}</Text></View>

      <View style={t.hr} />
      <Text style={t.netLbl}>NET BALANCE PAYABLE</Text>
      <Text style={t.net}>{formatNgn(data.net_balance)}</Text>

      <View style={t.hr} />
      <View style={t.row}><Text>Remaining advance debt</Text><Text style={t.val}>{data.remaining_debt > 0 ? formatNgn(data.remaining_debt) : "₦0 (cleared)"}</Text></View>
      <Text style={t.foot}>{data.site_name ?? ""} · Doc {docId}</Text>
    </Page>
  );
}

export function SupplyInvoicePdf({ data, docId, format = "a4" }: { data: PdfSupplyInvoiceData; docId: string; format?: InvoiceFormat }) {
  return (
    <Document title={`Supply Invoice — ${data.visit_id.slice(0, 8)}`}>
      {format === "thermal" ? <ThermalInvoice data={data} docId={docId} /> : <A4Invoice data={data} docId={docId} />}
    </Document>
  );
}
