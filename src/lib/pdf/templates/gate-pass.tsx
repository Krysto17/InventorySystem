import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { PdfGatePassData } from "../fetch-data";
import { formatTs, formatKg } from "../format";

// 80mm thermal gate pass — authorises material leaving the yard.
const W = 226.77;
const s = StyleSheet.create({
  page: { width: W, paddingHorizontal: 8, paddingVertical: 10, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  company: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", letterSpacing: 0.3 },
  rc: { fontSize: 7, textAlign: "center", marginTop: 1 },
  title: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3 },
  code: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 1, letterSpacing: 1 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#000", borderStyle: "dashed", marginVertical: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  lbl: { fontFamily: "Helvetica-Bold" },
  val: { textAlign: "right", flexShrink: 1, marginLeft: 6 },
  reason: { marginTop: 2 },
  status: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "center", marginVertical: 3 },
  blank: { borderBottomWidth: 1, borderBottomColor: "#000", flex: 1, marginLeft: 4, minHeight: 10 },
  signRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 8 },
  foot: { fontSize: 7, textAlign: "center", marginTop: 6, color: "#333" },
});

function Line({ label, value }: { label: string; value: string }) {
  return <View style={s.row}><Text style={s.lbl}>{label}</Text><Text style={s.val}>{value}</Text></View>;
}

export function GatePassPdf({ data, docId }: { data: PdfGatePassData; docId: string }) {
  return (
    <Document title={`Gate Pass — ${data.pass_code ?? data.id.slice(0, 8)}`}>
      <Page size={[W, 400]} style={s.page}>
        <Text style={s.company}>MAGNETIC JOEZION NIG. LTD</Text>
        <Text style={s.rc}>RC: 1966608</Text>
        <Text style={s.title}>GATE PASS</Text>
        {data.pass_code ? <Text style={s.code}>{data.pass_code}</Text> : null}

        <View style={s.hr} />
        <Line label="Date" value={formatTs(data.issued_at)} />
        <Line label="Site" value={data.site_name ?? "—"} />
        <Line label="Owner" value={data.owner ?? "—"} />
        <Line label="Material" value={data.material_name ?? "—"} />
        {data.bags != null ? <Line label="Bags" value={String(data.bags)} /> : null}
        {data.weight_kg != null ? <Line label="Weight" value={formatKg(data.weight_kg)} /> : null}

        <View style={s.hr} />
        <Text style={s.lbl}>Reason:</Text>
        <Text style={s.reason}>{data.reason || "—"}</Text>

        <View style={s.hr} />
        <Text style={s.status}>STATUS: {data.status.toUpperCase()}</Text>

        <View style={s.hr} />
        <Line label="Issued by" value={data.issued_by_name ?? "—"} />
        <View style={s.signRow}><Text style={s.lbl}>Bearer sign :</Text><View style={s.blank} /></View>
        <View style={s.signRow}><Text style={s.lbl}>Security sign :</Text><View style={s.blank} /></View>

        <Text style={s.foot}>Doc {docId}</Text>
      </Page>
    </Document>
  );
}
