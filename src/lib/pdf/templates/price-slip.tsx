import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { PdfPriceSlipData } from "../fetch-data";
import { formatTs } from "../format";

const ngn = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 });

// 80mm thermal receipt: 80mm ≈ 226.77pt wide. Height is generous enough for the
// content; the printer cuts at the page end. Single column, high-contrast, no
// heavy borders that waste thermal ink.
const WIDTH = 226.77;
const s = StyleSheet.create({
  page: { width: WIDTH, paddingHorizontal: 8, paddingVertical: 10, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  company: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", letterSpacing: 0.3 },
  rc: { fontSize: 7, textAlign: "center", marginTop: 1 },
  slipTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#000", borderStyle: "dashed", marginVertical: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  lbl: { fontFamily: "Helvetica-Bold" },
  val: { textAlign: "right", flexShrink: 1, marginLeft: 6 },
  amount: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginVertical: 4 },
  amountLbl: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center" },
  blank: { borderBottomWidth: 1, borderBottomColor: "#000", flex: 1, marginLeft: 4, minHeight: 10 },
  handRow: { flexDirection: "row", marginBottom: 5 },
  acct: { fontSize: 11, fontFamily: "Helvetica-Bold", letterSpacing: 2, marginTop: 1 },
  declText: { fontSize: 7.5, lineHeight: 1.35, marginTop: 2 },
  signRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 8 },
  note: { fontSize: 7, marginTop: 6, textAlign: "center", color: "#333" },
  thanks: { fontSize: 7.5, fontStyle: "italic", textAlign: "center", marginTop: 3, color: "#333" },
});

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.lbl}>{label}</Text>
      <Text style={s.val}>{value}</Text>
    </View>
  );
}

export function PriceSlipPdf({ data, docId }: { data: PdfPriceSlipData; docId: string }) {
  const now = new Date();
  const validDate = now.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
  const supplier = data.supplier_name ?? "—";
  const material = data.material_name ?? "—";
  const acct = (data.account_number ?? "").split("").join(" ");

  return (
    <Document title={`Price slip — ${data.receipt_no}`}>
      <Page size={[WIDTH, 460]} style={s.page}>
        <Text style={s.company}>MAGNETIC JOEZION NIG. LTD</Text>
        <Text style={s.rc}>RC: 1966608</Text>
        <Text style={s.slipTitle}>PRICE SLIP</Text>

        <View style={s.hr} />
        <Line label="Date" value={formatTs(data.visit_created_at)} />
        <Line label="Supplier" value={supplier} />
        <Line label="Supplier ID" value={data.supplier_code ?? "—"} />
        <Line label="Site" value={data.site_name ?? "—"} />

        <View style={s.hr} />
        <Line label="Material" value={material} />
        <Line label="Qty (Kg)" value={Number(data.weight_kg).toFixed(2)} />
        <Line label="Unit price" value={ngn(data.unit_price)} />
        {/* Grade + RA are written by hand after printing. */}
        <View style={s.handRow}><Text style={s.lbl}>Grade :</Text><View style={s.blank} /></View>
        <View style={s.handRow}><Text style={s.lbl}>RA (µSv/h) :</Text><View style={s.blank} /></View>

        <View style={s.hr} />
        <Text style={s.amountLbl}>AMOUNT (NGN)</Text>
        <Text style={s.amount}>{ngn(data.amount)}</Text>

        <View style={s.hr} />
        <Text style={s.lbl}>PAYMENT DETAILS</Text>
        <Line label="Account name" value={data.account_name ?? ""} />
        <Line label="Bank" value={data.bank_name ?? ""} />
        <Text style={s.lbl}>Account number:</Text>
        <Text style={s.acct}>{acct || "—"}</Text>

        <View style={s.hr} />
        <Text style={s.lbl}>DECLARATION</Text>
        <Text style={s.declText}>
          I, {supplier} hereby declare that the {Number(data.weight_kg).toFixed(2)} Kg of {material} supplied is
          legally mined and free of any conflict.
        </Text>
        <View style={s.signRow}><Text style={s.lbl}>Customer sign :</Text><View style={s.blank} /></View>
        <View style={s.signRow}><Text style={s.lbl}>Paid :</Text><View style={s.blank} /></View>

        <Text style={s.note}>Price valid until today, {validDate} 5:00pm</Text>
        <Text style={s.thanks}>Thank you · {docId}</Text>
      </Page>
    </Document>
  );
}
