import { View, Text, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  header: {
    backgroundColor: "#000000",
    paddingHorizontal: 24,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
  },
  headerSub: {
    color: "#aaaaaa",
    fontSize: 8,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#cccccc",
    paddingTop: 4,
  },
  footerText: {
    fontSize: 7,
    color: "#999999",
  },
});

export function BrandHeader({ siteName, docType, rc }: { siteName?: string | null; docType: string; rc?: string | null }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle}>MAGNETIC JOEZION NIG. LTD</Text>
        {rc ? <Text style={styles.headerSub}>RC: {rc}</Text> : null}
        <Text style={styles.headerSub}>
          {siteName ? `${siteName} · ` : ""}Inventory &amp; Material Tracking
        </Text>
      </View>
      <Text style={styles.headerSub}>{docType}</Text>
    </View>
  );
}

export function PageFooter({ docId, generatedAt }: { docId: string; generatedAt: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Doc ID: {docId}</Text>
      <Text style={styles.footerText}>{generatedAt}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
        fixed
      />
    </View>
  );
}
