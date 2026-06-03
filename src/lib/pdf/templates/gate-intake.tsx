import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfVisitData } from "../fetch-data";
import { formatTs, formatNgn } from "../format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={shared.row}>
      <Text style={shared.label}>{label}</Text>
      <Text style={shared.value}>{value}</Text>
    </View>
  );
}

export function GateIntakePdf({ data, docId }: { data: PdfVisitData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Gate Intake — ${data.id.slice(0, 8)}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Gate Intake Slip" />
        <Text style={shared.docTitle}>Gate Intake Slip</Text>
        <Text style={shared.docSubtitle}>Visit {data.id} · {formatTs(data.created_at)}</Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Supplier</Text>
            <Row label="Name"  value={data.supplier_name ?? "—"} />
            <Row label="Phone" value={data.supplier_phone ?? "—"} />
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Visit details</Text>
            <Row label="Visit ID"       value={data.id} />
            <Row label="Material"       value={data.material_type_name ?? "—"} />
            <Row label="Entry path"     value={data.entry_path} />
            <Row label="Vehicle plate"  value={data.vehicle_plate ?? "—"} />
            <Row label="Site"           value={data.site_name ?? "—"} />
            <Row label="Opened"         value={formatTs(data.created_at)} />
            {data.closed_at && <Row label="Closed" value={formatTs(data.closed_at)} />}
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Recorded by</Text>
            <Row label="Gate officer" value={data.created_by_name ?? "—"} />
          </View>

          {data.processing && (
            <View style={shared.highlight}>
              <Text style={[shared.label, { marginBottom: 3 }]}>Processing fee (preliminary)</Text>
              <Text style={[shared.bold, { fontSize: 12 }]}>{formatNgn(data.processing.total_fee)}</Text>
            </View>
          )}
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
