import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { BrandHeader, PageFooter } from "../brand";
import { shared } from "../styles";
import { formatNgn } from "../format";
import { linesFor, totalOf, type PlRow } from "@/lib/finance/profit-loss";

const s = StyleSheet.create({
  line: { flexDirection: "row", marginBottom: 2.5 },
  lineLabel: { flex: 1, fontSize: 9 },
  lineHint: { fontSize: 7, color: "#777777" },
  lineAmount: { width: 110, textAlign: "right", fontSize: 9 },
  indent: { paddingLeft: 12 },
  subtotal: {
    flexDirection: "row", marginTop: 3, paddingTop: 3,
    borderTopWidth: 0.5, borderTopColor: "#999999",
  },
  bold: { fontFamily: "Helvetica-Bold" },
  bottomBox: {
    marginTop: 10, padding: 8,
    borderWidth: 0.5, borderColor: "#999999",
  },
  bottomTitle: { fontSize: 7, color: "#555555", textTransform: "uppercase", letterSpacing: 0.5 },
  bottomValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  bottomNote: { fontSize: 7, color: "#777777", marginTop: 2 },
  th: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#999999", paddingBottom: 2, marginBottom: 2 },
  thCell: { fontSize: 7, color: "#555555", textTransform: "uppercase" },
  td: { flexDirection: "row", paddingVertical: 1.5 },
  colSite: { flex: 1 },
  colNum: { width: 85, textAlign: "right" },
  memo: { marginTop: 10, padding: 8, borderWidth: 0.5, borderColor: "#cccccc" },
});

function Line({
  label, hint, amount, indent, bold, negative,
}: {
  label: string; hint?: string; amount: number;
  indent?: boolean; bold?: boolean; negative?: boolean;
}) {
  return (
    <View style={[s.line, ...(indent ? [s.indent] : [])]}>
      <View style={s.lineLabel}>
        <Text style={bold ? s.bold : undefined}>{label}</Text>
        {hint ? <Text style={s.lineHint}>{hint}</Text> : null}
      </View>
      <Text style={[s.lineAmount, ...(bold ? [s.bold] : [])]}>
        {negative ? `(${formatNgn(amount)})` : formatNgn(amount)}
      </Text>
    </View>
  );
}

/**
 * The profit-and-loss statement, laid out as a statement of account.
 *
 * It shows two bottom lines rather than one. Material cost is genuinely two
 * different numbers — cash paid to suppliers in the period, and the cost of
 * only what was sold — and in a month of heavy buying one reads as a loss
 * while the other reads as a profit. Both are true, so the statement prints
 * both and says what each one means instead of quietly choosing.
 */
export function ProfitLossPdf({
  rows, from, to, docId,
}: { rows: PlRow[]; from: string; to: string; docId: string }) {
  const t = totalOf(rows);
  const l = linesFor(t);
  const generatedAt = new Date().toISOString();
  const unreceived = t.salesTotal - t.salesReceived;

  return (
    <Document title={`Profit and loss ${from} to ${to}`}>
      <Page size="A4" style={shared.page}>
        <BrandHeader docType="Statement of Profit or Loss" />
        <View style={shared.body}>
          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Period</Text>
            <Line label={`${from} to ${to}`} hint="All sites combined" amount={0} />
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Income</Text>
            <Line indent label="Material sold" amount={t.salesTotal}
              hint="Bulk sales approved by the owner, at the agreed price" />
            <Line indent label="Processing fees and light bills collected" amount={t.feesCollected}
              hint="Netted off a paid settlement, taken in cash, or recovered later" />
            <View style={s.subtotal}>
              <Text style={[s.lineLabel, s.bold]}>Total income</Text>
              <Text style={[s.lineAmount, s.bold]}>{formatNgn(l.income)}</Text>
            </View>
          </View>

          <View style={shared.section}>
            <Text style={shared.sectionTitle}>Costs</Text>
            <Line indent negative label="Materials — paid to suppliers" amount={t.materialsCash}
              hint="Money that actually left in this period (cash basis)" />
            <Line indent negative label="Materials — cost of what was sold" amount={t.materialsCogs}
              hint="Sold weight at the weighted average cost of its lots" />
            <Line indent negative label="Expenses" amount={t.expenses}
              hint="Approved expenses. Wages category excluded — see salaries" />
            <Line indent negative label="Salaries" amount={t.salaries}
              hint="Payroll figure entered for each month in this period" />
            <Line indent negative label="Supplier compensations" amount={t.corrections}
              hint="Under-priced supplies topped up after payment" />
          </View>

          <View style={s.bottomBox}>
            <Text style={s.bottomTitle}>Profit / loss — cash basis</Text>
            <Text style={s.bottomValue}>
              {l.profitCash < 0 ? `Loss ${formatNgn(Math.abs(l.profitCash))}` : formatNgn(l.profitCash)}
            </Text>
            <Text style={s.bottomNote}>
              Income {formatNgn(l.income)} less costs {formatNgn(l.costCash)}. Counts everything
              paid to suppliers in the period, so it matches the bank; a period of heavy buying
              reads as a loss while that stock is still in the yard.
            </Text>
          </View>

          <View style={s.bottomBox}>
            <Text style={s.bottomTitle}>Profit / loss — on material sold</Text>
            <Text style={s.bottomValue}>
              {l.profitOfSales < 0 ? `Loss ${formatNgn(Math.abs(l.profitOfSales))}` : formatNgn(l.profitOfSales)}
            </Text>
            <Text style={s.bottomNote}>
              Income {formatNgn(l.income)} less costs {formatNgn(l.costOfSales)}. Counts only the
              cost of material that left, so unsold stock stays as stock. This is the figure to
              judge selling prices against.
            </Text>
          </View>

          <View style={shared.section} wrap={false}>
            <Text style={[shared.sectionTitle, { marginTop: 12 }]}>By site</Text>
            <View style={s.th}>
              <Text style={[s.thCell, s.colSite]}>Site</Text>
              <Text style={[s.thCell, s.colNum]}>Income</Text>
              <Text style={[s.thCell, s.colNum]}>Costs (cash)</Text>
              <Text style={[s.thCell, s.colNum]}>P/L cash</Text>
              <Text style={[s.thCell, s.colNum]}>P/L on sales</Text>
            </View>
            {rows.map((r) => {
              const rl = linesFor(r);
              return (
                <View key={r.siteId} style={s.td}>
                  <Text style={s.colSite}>{r.siteName}</Text>
                  <Text style={s.colNum}>{formatNgn(rl.income)}</Text>
                  <Text style={s.colNum}>{formatNgn(rl.costCash)}</Text>
                  <Text style={s.colNum}>{formatNgn(rl.profitCash)}</Text>
                  <Text style={s.colNum}>{formatNgn(rl.profitOfSales)}</Text>
                </View>
              );
            })}
            <View style={[s.td, { borderTopWidth: 0.5, borderTopColor: "#999999", marginTop: 2, paddingTop: 2 }]}>
              <Text style={[s.colSite, s.bold]}>All sites</Text>
              <Text style={[s.colNum, s.bold]}>{formatNgn(l.income)}</Text>
              <Text style={[s.colNum, s.bold]}>{formatNgn(l.costCash)}</Text>
              <Text style={[s.colNum, s.bold]}>{formatNgn(l.profitCash)}</Text>
              <Text style={[s.colNum, s.bold]}>{formatNgn(l.profitOfSales)}</Text>
            </View>
          </View>

          {(unreceived > 0.005 || t.wagesInExpenses > 0.005) && (
            <View style={s.memo}>
              <Text style={[s.bottomTitle, { marginBottom: 3 }]}>Notes</Text>
              {unreceived > 0.005 && (
                <Text style={s.lineHint}>
                  {formatNgn(unreceived)} of the material sold has not been received yet. Income
                  above is the agreed sale value, not cash in hand.
                </Text>
              )}
              {t.wagesInExpenses > 0.005 && (
                <Text style={s.lineHint}>
                  {formatNgn(t.wagesInExpenses)} sits in the Wages expense category and is NOT
                  counted above. Salaries come from the figure entered for each month, so counting
                  both would double it.
                </Text>
              )}
            </View>
          )}
        </View>
        <PageFooter docId={docId} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
