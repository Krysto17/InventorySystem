import { StyleSheet } from "@react-pdf/renderer";

export const shared = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111111",
    paddingBottom: 50,
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#555555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#cccccc",
    paddingBottom: 3,
  },
  row: {
    flexDirection: "row",
    marginBottom: 3,
  },
  label: {
    width: 120,
    color: "#666666",
    fontSize: 8,
  },
  value: {
    flex: 1,
    fontSize: 9,
  },
  bold: {
    fontFamily: "Helvetica-Bold",
  },
  table: {
    marginTop: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#eeeeee",
    paddingVertical: 3,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cccccc",
    paddingBottom: 3,
    marginBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#555555",
    textTransform: "uppercase",
  },
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 24,
  },
  docSubtitle: {
    fontSize: 9,
    color: "#666666",
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  highlight: {
    backgroundColor: "#f5f5f5",
    padding: 8,
    borderRadius: 2,
    marginBottom: 10,
  },
  highlightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
});
