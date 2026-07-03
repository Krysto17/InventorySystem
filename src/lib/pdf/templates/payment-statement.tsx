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

export function PaymentStatementPdf({ data, docId }: { data: PdfVisitData; docId: string }) {
  const generatedAt = new Date().toISOString();
  const processingFeeOwed = data.processing?.total_fee ?? 0;
  const purchaseAmountOwed = data.pricing?.purchase_amount ?? 0;
  const processingPaid = data.payments.filter((p) => p.direction === "processing_fee_in").reduce((s, p) => s + p.amount, 0);
  const purchasePaid   = data.payments.filter((p) => p.direction === "purchase_amount_out").reduce((s, p) => s + p.amount, 0);

  const netProcessingBalance = data.processing_deducted
    ? 0
    : processingFeeOwed - processingPaid;
  const netPurchaseBalance = data.processing_deducted
    ? purchaseAmountOwed - processingFeeOwed - purchasePaid
    : purchaseAmountOwed - purchasePaid;

  return (
    <Document title={`Payment Statement — ${data.id.slice(0, 8)}`}>
      <Page size="A5" style={shared.page}>
        <BrandHeader siteName={data.site_name} docType="Payment Statement" />
        <Text style={shared.docTitle}>Payment Statement</Text>
        <Text style={shared.docSubtitle}>
          Visit {data.id} · Supplier: {data.supplier_name ?? "—"}
        </Text>

        <View style={shared.body}>
          <View style={[shared.highlight, { marginBottom: 14 }]}>
            <View style={shared.highlightRow}>
              <Text style={shared.label}>Processing fee owed</Text>
              <Text style={shared.bold}>{formatNgn(processingFeeOwed)}</Text>
            </View>
            <View style={shared.highlightRow}>
              <Text style={shared.label}>Processing fee paid</Text>
              <Text>{formatNgn(processingPaid)}</Text>
            </View>
            <View style={[shared.highlightRow, { marginTop: 4 }]}>
              <Text style={shared.label}>Purchase amount owed</Text>
              <Text style={shared.bold}>{formatNgn(purchaseAmountOwed)}</Text>
            </View>
            <View style={shared.highlightRow}>
              <Text style={shared.label}>Purchase amount paid</Text>
              <Text>{formatNgn(purchasePaid)}</Text>
            </View>
            {data.processing_deducted && (
              <Text style={{ fontSize: 8, color: "#555", marginTop: 4 }}>
                * Processing fee deducted from purchase amount (net settlement)
              </Text>
            )}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 14 }}>
            <View style={[shared.highlight, { flex: 1, marginRight: 6 }]}>
              <Text style={shared.label}>Fee balance due</Text>
              <Text style={[shared.bold, { fontSize: 12, color: netProcessingBalance > 0 ? "#b91c1c" : "#15803d" }]}>
                {formatNgn(Math.abs(netProcessingBalance))}
                {netProcessingBalance <= 0 ? " ✓" : ""}
              </Text>
            </View>
            <View style={[shared.highlight, { flex: 1 }]}>
              <Text style={shared.label}>Purchase balance due</Text>
              <Text style={[shared.bold, { fontSize: 12, color: netPurchaseBalance > 0 ? "#b91c1c" : "#15803d" }]}>
                {formatNgn(Math.abs(netPurchaseBalance))}
                {netPurchaseBalance <= 0 ? " ✓" : ""}
              </Text>
            </View>
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Payment ledger ({data.payments.length} entries)</Text>
            {data.payments.length === 0 ? (
              <Text style={{ fontSize: 9, color: "#999" }}>No payments recorded.</Text>
            ) : (
              <View style={shared.table}>
                <View style={shared.tableHeader}>
                  <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Date</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 3 }]}>Direction</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 2 }]}>Method</Text>
                  <Text style={[shared.tableHeaderCell, { flex: 2, textAlign: "right" }]}>Amount</Text>
                </View>
                {data.payments.map((p) => (
                  <View key={p.id} style={shared.tableRow}>
                    <Text style={{ flex: 2, fontSize: 8 }}>{formatTs(p.paid_at)}</Text>
                    <Text style={{ flex: 3, fontSize: 8 }}>
                      {p.direction === "processing_fee_in" ? "Processing fee in" : "Purchase payout"}
                    </Text>
                    <Text style={{ flex: 2, fontSize: 8 }}>{p.method ?? "—"}</Text>
                    <Text style={{ flex: 2, fontSize: 8, textAlign: "right" }}>{formatNgn(p.amount)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
