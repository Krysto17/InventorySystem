import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import type { PdfBulkSaleData } from "../fetch-data";
import { formatTs, formatNgn, formatKg } from "../format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={shared.row}>
      <Text style={shared.label}>{label}</Text>
      <Text style={shared.value}>{value}</Text>
    </View>
  );
}

export function BulkSaleReceiptPdf({ data, docId }: { data: PdfBulkSaleData; docId: string }) {
  const generatedAt = new Date().toISOString();
  return (
    <Document title={`Bulk Sale Receipt — ${data.id.slice(0, 8)}`}>
      <Page size="A5" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Bulk Sale Receipt" />
        <Text style={shared.docTitle}>Bulk Sale Receipt</Text>
        <Text style={shared.docSubtitle}>
          Sale {data.id} · {formatTs(data.sold_at)}
        </Text>

        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Buyer</Text>
            <Row label="Name"  value={data.buyer_name} />
            <Row label="Phone" value={data.buyer_phone ?? "—"} />
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Material</Text>
            <Row label="Type"       value={data.material_type_name ?? "—"} />
            <Row label="Grade"      value={data.grade ?? "—"} />
            <Row label="Weight"     value={formatKg(data.weight)} />
            <Row label="Unit price" value={`${formatNgn(data.unit_price)}/kg`} />
          </View>

          <View style={[shared.highlight, { marginBottom: 14 }]}>
            <Text style={shared.label}>Total sale amount</Text>
            <Text style={[shared.bold, { fontSize: 16, marginTop: 2 }]}>{formatNgn(data.total)}</Text>
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Approval</Text>
            <Row label="Status"      value={data.approval_status.toUpperCase()} />
            <Row label="Approved by" value={data.approved_by_name ?? "—"} />
            <Row label="Approved at" value={formatTs(data.approved_at)} />
            <Row label="Submitted by" value={data.recorded_by_name ?? "—"} />
            <Row label="Site"        value={data.site_name ?? "—"} />
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
