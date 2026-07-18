import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { PdfPriceSlipData } from "../fetch-data";
import { formatTs } from "../format";

export type SlipFormat = "a5" | "thermal";

const ngn = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 });

// ─── A5 (full page) ──────────────────────────────────────────────────────────
const a = StyleSheet.create({
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
  signBox: { borderWidth: 1, borderColor: "#000", height: 24, width: 150, marginTop: 2, marginBottom: 4 },
  blank: { borderBottomWidth: 1, borderBottomColor: "#000", width: 90, marginLeft: 4 },
  amount: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 6 },
  note: { fontSize: 7, textAlign: "right", maxWidth: 200 },
  commentBox: { borderWidth: 1, borderColor: "#000", height: 62, marginTop: 3 },
  splitRow: { flexDirection: "row", justifyContent: "space-between" },
  commentCol: { flex: 1, marginRight: 10 },
  bankCol: { width: 168 },
  bankTitle: { fontFamily: "Helvetica-Bold", marginBottom: 3 },
  bankLine: { flexDirection: "row", alignItems: "flex-end", marginBottom: 3 },
  bankLbl: { fontFamily: "Helvetica-Bold", fontSize: 8 },
  bankVal: { flex: 1, marginLeft: 4, fontSize: 8, borderBottomWidth: 1, borderBottomColor: "#000", paddingBottom: 1, minHeight: 10 },
  acctBoxes: { flexDirection: "row", marginTop: 2 },
  acctCell: { width: 15, height: 17, borderWidth: 1, borderColor: "#000", marginRight: 1, alignItems: "center", justifyContent: "center" },
  acctDigit: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  decl: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  declText: { fontSize: 8, lineHeight: 1.3 },
  thanks: { fontSize: 8, fontStyle: "italic", marginTop: 3, color: "#555" },
});

function A5Slip({ data, docId }: { data: PdfPriceSlipData; docId: string }) {
  const now = new Date();
  const validDate = now.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
  const supplier = data.supplier_name ?? "—";
  const material = data.material_name ?? "—";
  return (
    <Page size="A5" orientation="landscape" style={a.page}>
      <View style={a.card}>
        <Text style={a.printedOn}>Printed on : {formatTs(now.toISOString())}</Text>
        <View style={a.title}>
          <Text style={a.company}>MAGNETIC JOEZION NIG. LTD</Text>
          <Text style={a.rc}>RC: 1966608</Text>
        </View>
        <View style={a.hr} />
        <View style={a.cols}>
          <View style={a.col}>
            <View style={a.line}><Text style={a.lbl}>Date:</Text><Text style={a.val}>{formatTs(data.visit_created_at)}</Text></View>
            <View style={a.line}><Text style={a.lbl}>Supplier:</Text><Text style={a.val}>{supplier}</Text></View>
            <View style={a.line}><Text style={a.lbl}>Supplier ID:</Text><Text style={a.val}>{data.supplier_code ?? "—"}</Text></View>
            <View style={a.line}><Text style={a.lbl}>Site:</Text><Text style={a.val}>{data.site_name ?? "—"}</Text></View>
          </View>
          <View style={a.col}>
            <Text style={a.lbl}>Customer Sign :</Text><View style={a.signBox} />
            <Text style={a.lbl}>Paid :</Text><View style={a.signBox} />
          </View>
        </View>
        <View style={a.hr} />
        <View style={a.cols}>
          <View style={a.col}>
            <View style={a.line}><Text style={a.lbl}>Material :</Text><Text style={a.val}>{material}</Text></View>
            <View style={a.line}><Text style={a.lbl}>Qty (Kg) :</Text><Text style={a.val}>{Number(data.weight_kg).toFixed(2)}</Text></View>
            <View style={a.line}><Text style={a.lbl}>Unit price :</Text><Text style={a.val}>{ngn(data.unit_price)}</Text></View>
          </View>
          <View style={a.col}>
            {/* Grade + RA written by hand after printing. */}
            <View style={a.line}><Text style={a.lbl}>Grade :</Text><View style={a.blank} /></View>
            <View style={a.line}><Text style={a.lbl}>RA (µSv/h) :</Text><View style={a.blank} /></View>
          </View>
        </View>
        <Text style={a.amount}>Amount (NGN) : {ngn(data.amount)}</Text>
        <View style={a.hr} />
        <View style={a.splitRow}>
          <View style={a.commentCol}>
            <View style={a.cols}>
              <Text style={a.lbl}>COMMENTS:</Text>
              <Text style={a.note}>NOTE: Price is valid until today, {validDate} 5:00pm</Text>
            </View>
            <View style={a.commentBox} />
          </View>
          <View style={a.bankCol}>
            <Text style={a.bankTitle}>PAYMENT DETAILS:</Text>
            <View style={a.bankLine}><Text style={a.bankLbl}>Account name:</Text><Text style={a.bankVal}>{data.account_name ?? ""}</Text></View>
            <View style={a.bankLine}><Text style={a.bankLbl}>Bank name:</Text><Text style={a.bankVal}>{data.bank_name ?? ""}</Text></View>
            <Text style={[a.bankLbl, { marginTop: 3 }]}>Account number:</Text>
            <View style={a.acctBoxes}>
              {Array.from({ length: 10 }, (_, i) => (
                <View key={i} style={a.acctCell}><Text style={a.acctDigit}>{(data.account_number ?? "")[i] ?? ""}</Text></View>
              ))}
            </View>
          </View>
        </View>
        <View style={a.hr} />
        <Text style={a.decl}>DECLARATION:</Text>
        <Text style={a.declText}>
          I, {supplier} hereby declare that the {Number(data.weight_kg).toFixed(2)} Kg of {material} supplied is
          legally mined and free of any conflict.
        </Text>
        <Text style={a.thanks}>Thank you. · Doc {docId}</Text>
      </View>
    </Page>
  );
}

// ─── 80mm thermal receipt ─────────────────────────────────────────────────────
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

function TLine({ label, value }: { label: string; value: string }) {
  return <View style={s.row}><Text style={s.lbl}>{label}</Text><Text style={s.val}>{value}</Text></View>;
}

function ThermalSlip({ data, docId }: { data: PdfPriceSlipData; docId: string }) {
  const now = new Date();
  const validDate = now.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
  const supplier = data.supplier_name ?? "—";
  const material = data.material_name ?? "—";
  const acct = (data.account_number ?? "").split("").join(" ");
  return (
    <Page size={[WIDTH, 460]} style={s.page}>
      <Text style={s.company}>MAGNETIC JOEZION NIG. LTD</Text>
      <Text style={s.rc}>RC: 1966608</Text>
      <Text style={s.slipTitle}>PRICE SLIP</Text>

      <View style={s.hr} />
      <TLine label="Date" value={formatTs(data.visit_created_at)} />
      <TLine label="Supplier" value={supplier} />
      <TLine label="Supplier ID" value={data.supplier_code ?? "—"} />
      <TLine label="Site" value={data.site_name ?? "—"} />

      <View style={s.hr} />
      <TLine label="Material" value={material} />
      <TLine label="Qty (Kg)" value={Number(data.weight_kg).toFixed(2)} />
      <TLine label="Unit price" value={ngn(data.unit_price)} />
      <View style={s.handRow}><Text style={s.lbl}>Grade :</Text><View style={s.blank} /></View>
      <View style={s.handRow}><Text style={s.lbl}>RA (µSv/h) :</Text><View style={s.blank} /></View>

      <View style={s.hr} />
      <Text style={s.amountLbl}>AMOUNT (NGN)</Text>
      <Text style={s.amount}>{ngn(data.amount)}</Text>

      <View style={s.hr} />
      <Text style={s.lbl}>PAYMENT DETAILS</Text>
      <TLine label="Account name" value={data.account_name ?? ""} />
      <TLine label="Bank" value={data.bank_name ?? ""} />
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
  );
}

export function PriceSlipPdf({ data, docId, format = "a5" }: { data: PdfPriceSlipData; docId: string; format?: SlipFormat }) {
  return (
    <Document title={`Price slip — ${data.receipt_no}`}>
      {format === "thermal" ? <ThermalSlip data={data} docId={docId} /> : <A5Slip data={data} docId={docId} />}
    </Document>
  );
}
