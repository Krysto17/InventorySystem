import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { PdfPriceSlipData } from "../fetch-data";
import { formatTs } from "../format";

const ngn = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 });

const s = StyleSheet.create({
  page: { padding: 18, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  card: { borderWidth: 1, borderColor: "#000", padding: 12, height: "100%" },
  printedOn: { fontSize: 7, color: "#333" },
  title: { textAlign: "center", marginTop: 2 },
  company: { fontSize: 13, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  rc: { fontSize: 7, marginTop: 1 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#000", marginVertical: 8 },
  cols: { flexDirection: "row", justifyContent: "space-between" },
  col: { flexDirection: "column" },
  line: { flexDirection: "row", marginBottom: 4 },
  lbl: { fontFamily: "Helvetica-Bold" },
  val: { marginLeft: 4 },
  boxRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  box: { borderWidth: 1, borderColor: "#000", height: 12, width: 120, marginLeft: 4 },
  signBox: { borderWidth: 1, borderColor: "#000", height: 22, width: 110, marginTop: 2, marginBottom: 4 },
  blank: { borderBottomWidth: 1, borderBottomColor: "#000", width: 70, marginLeft: 4 },
  amount: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 6 },
  note: { fontSize: 7, textAlign: "right", maxWidth: 180 },
  decl: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  declText: { fontSize: 8, lineHeight: 1.3 },
  thanks: { fontSize: 8, fontStyle: "italic", marginTop: 3, color: "#555" },
});

function LabelBox({ label }: { label: string }) {
  return (
    <View style={s.boxRow}>
      <Text style={s.lbl}>{label}</Text>
      <View style={s.box} />
    </View>
  );
}

export function PriceSlipPdf({ data, docId }: { data: PdfPriceSlipData; docId: string }) {
  const now = new Date();
  const validDate = now.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
  const supplier = data.supplier_name ?? "—";
  const material = data.material_name ?? "—";

  return (
    <Document title={`Price slip — ${data.receipt_no}`}>
      <Page size="A5" orientation="landscape" style={s.page}>
        <View style={s.card}>
          <Text style={s.printedOn}>Printed on : {formatTs(now.toISOString())}</Text>

          <View style={s.title}>
            <Text style={s.company}>MAGNETIC JOEZION NIG. LTD</Text>
            <Text style={s.rc}>RC: 1966608</Text>
          </View>

          <View style={s.hr} />

          <View style={s.cols}>
            <View style={s.col}>
              <View style={s.line}><Text style={s.lbl}>Date:</Text><Text style={s.val}>{formatTs(data.visit_created_at)}</Text></View>
              <View style={s.line}><Text style={s.lbl}>Receipt:</Text><Text style={s.val}>{data.receipt_no}</Text></View>
              <View style={s.line}><Text style={s.lbl}>Supplier:</Text><Text style={s.val}>{supplier}</Text></View>
            </View>
            <View style={s.col}>
              <LabelBox label="Account Name :" />
              <LabelBox label="Account No :" />
              <LabelBox label="Bank Name :" />
            </View>
          </View>

          <View style={s.hr} />

          <View style={s.cols}>
            <View style={s.col}>
              <View style={s.line}><Text style={s.lbl}>Material :</Text><Text style={s.val}>{material}</Text></View>
              <View style={s.line}><Text style={s.lbl}>Qty (Kg) :</Text><Text style={s.val}>{Number(data.weight_kg).toFixed(2)}</Text></View>
              <View style={s.line}><Text style={s.lbl}>Rate :</Text><Text style={s.val}>{ngn(data.unit_price)}</Text></View>
            </View>
            <View style={s.col}>
              {/* Grade + RA are written by hand after printing. */}
              <View style={s.line}><Text style={s.lbl}>Grade :</Text><View style={s.blank} /></View>
              <View style={s.line}><Text style={s.lbl}>RA :</Text><View style={s.blank} /></View>
            </View>
            <View style={s.col}>
              <Text style={s.lbl}>Customer Sign :</Text><View style={s.signBox} />
              <Text style={s.lbl}>Paid :</Text><View style={s.signBox} />
            </View>
          </View>

          <Text style={s.amount}>Amount (NGN) : {ngn(data.amount)}</Text>

          <View style={s.hr} />

          <View style={s.cols}>
            <Text style={s.lbl}>COMMENTS:</Text>
            <Text style={s.note}>NOTE: Price is valid until today, {validDate} 5:00pm</Text>
          </View>

          <View style={s.hr} />

          <Text style={s.decl}>DECLARATION:</Text>
          <Text style={s.declText}>
            I, {supplier} hereby declare that the {Number(data.weight_kg).toFixed(2)} Kg of {material} supplied is
            legally mined and free of any conflict.
          </Text>
          <Text style={s.thanks}>Thank you. · Doc {docId}</Text>
        </View>
      </Page>
    </Document>
  );
}
