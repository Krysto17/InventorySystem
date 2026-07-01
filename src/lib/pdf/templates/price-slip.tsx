import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfPriceSlipData } from "../fetch-data";
import { formatTs, formatKg } from "../format";

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `NGN ${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

const s = StyleSheet.create({
  rc: { fontSize: 8, color: "#666666", marginTop: -12, marginBottom: 12, paddingHorizontal: 24 },
  fillLine: { flex: 1, borderBottomWidth: 0.8, borderBottomColor: "#333333", height: 11 },
  note: { fontSize: 8, color: "#666666", marginBottom: 12 },
  commentBox: { borderWidth: 0.8, borderColor: "#333333", height: 150, marginTop: 4, borderRadius: 2 },
  decl: { fontSize: 8, color: "#444444", lineHeight: 1.4, marginTop: 12 },
});

function Field({ label, value, fill }: { label: string; value?: string; fill?: boolean }) {
  return (
    <View style={shared.row}>
      <Text style={shared.label}>{label}</Text>
      {fill ? <View style={s.fillLine} /> : <Text style={shared.value}>{value ?? "—"}</Text>}
    </View>
  );
}

export function PriceSlipPdf({ data, docId }: { data: PdfPriceSlipData; docId: string }) {
  const now = new Date();
  const validDate = now.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
  const supplier = data.supplier_name ?? "—";
  const material = data.material_name ?? "—";

  return (
    <Document title={`Price Slip — ${data.receipt_no}`}>
      <Page size="A5" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Price Slip" />
        <Text style={shared.docTitle}>Purchase Price Slip</Text>
        <Text style={shared.docSubtitle}>
          {supplier}{data.supplier_code ? ` · ${data.supplier_code}` : ""} · {formatTs(data.visit_created_at)}
        </Text>
        <Text style={s.rc}>RC: 1966608</Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Field label="Slip no." value={data.receipt_no} />
            <Field label="Site" value={data.site_name ?? "—"} />
            <Field label="Vendor" value={supplier} />
            <Field label="Vendor ID" value={data.supplier_code ?? "—"} />
            <Field label="Commodity" value={material} />
            <Field label="Weight" value={formatKg(data.weight_kg)} />
            <Field label="Unit price" value={`${ngn(data.unit_price)} / kg`} />
            {/* Grade + RA are written in by hand after printing. */}
            <Field label="Grade" fill />
            <Field label="RA (µSv/h)" fill />
          </View>

          <View style={shared.highlight}>
            <Text style={shared.label}>Total payable</Text>
            <Text style={[shared.bold, { fontSize: 16, marginTop: 2 }]}>{ngn(data.amount)}</Text>
          </View>

          <Text style={s.note}>Note: Offer valid until today, {validDate} 5:00pm.</Text>

          <Text style={shared.sectionTitle}>Comment / Remarks</Text>
          <View style={s.commentBox} />

          <Text style={s.decl}>
            Declaration: I, {supplier}, hereby declare that the {formatKg(data.weight_kg)} of {material} supplied is
            legally mined and free of any conflict. Thank you.
          </Text>
        </View>

        <PageFooter docId={docId} generatedAt={now.toISOString()} />
      </Page>
    </Document>
  );
}
