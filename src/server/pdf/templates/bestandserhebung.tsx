import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { BestandserhebungBreakdown } from "~/server/db/schema/bestandserhebungen";
import { pdfBoldFamily, pdfBoldWeight, pdfFamily } from "~/server/pdf/fonts";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: pdfFamily(),
    color: "#111",
    lineHeight: 1.35,
  },
  h1: { fontSize: 16, fontFamily: pdfBoldFamily(), fontWeight: pdfBoldWeight(), marginBottom: 4 },
  meta: { fontSize: 8, color: "#555", marginBottom: 12 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
    marginTop: 14,
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingBottom: 2,
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
    fontSize: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    paddingVertical: 2,
  },
  totalsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#000",
    paddingVertical: 3,
    marginTop: 1,
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
  },
  cName: { flex: 2, paddingRight: 4 },
  cSport: { flex: 1.5, paddingRight: 4 },
  cVerband: { flex: 2, paddingRight: 4 },
  cNum: { width: 38, textAlign: "right", paddingRight: 2 },
  signature: {
    marginTop: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 9,
  },
  sigBox: {
    flex: 1,
    marginRight: 18,
  },
  sigLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    height: 32,
    marginBottom: 2,
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#777",
  },
});

export function BestandserhebungDocument({
  data,
  vereinsname,
}: {
  data: BestandserhebungBreakdown;
  vereinsname: string;
}) {
  // A Bestandserhebung is identified by its Stichtag, not a running counter:
  // the same Stichtag must always carry the same reference, however often it
  // is exported.
  const docRef = `BE-${data.stichtag}`;
  return (
    <Document title={`Bestandserhebung ${docRef} · ${vereinsname}`} author={vereinsname}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.h1}>Bestandserhebung</Text>
        <Text style={styles.meta}>
          Dokument {docRef} · {vereinsname} · Stichtag{" "}
          {/* Format the YYYY-MM-DD Stichtag directly so it never shifts a day
              via timezone-dependent Date parsing. */}
          {data.stichtag.split("-").reverse().join(".")} · Mitglieder gesamt: {data.grandTotal}
        </Text>

        <Text style={styles.sectionTitle}>Übersicht je Abteilung</Text>
        <View style={styles.tableHeader} wrap={false}>
          <Text style={styles.cName}>Abteilung</Text>
          <Text style={styles.cSport}>Sportart</Text>
          <Text style={styles.cVerband}>Verband</Text>
          <Text style={styles.cNum}>m</Text>
          <Text style={styles.cNum}>w</Text>
          <Text style={styles.cNum}>d</Text>
          <Text style={styles.cNum}>Σ</Text>
        </View>
        {data.perAbteilung.map((a) => (
          <View key={a.abteilungId} style={styles.tableRow} wrap={false}>
            <Text style={styles.cName}>{a.abteilungName}</Text>
            <Text style={styles.cSport}>{a.sportart ?? "—"}</Text>
            <Text style={styles.cVerband}>
              {a.verbandName ? `${a.verbandName}${a.verbandNr ? ` (${a.verbandNr})` : ""}` : "—"}
            </Text>
            <Text style={styles.cNum}>{a.male}</Text>
            <Text style={styles.cNum}>{a.female}</Text>
            <Text style={styles.cNum}>{a.divers}</Text>
            <Text style={styles.cNum}>{a.total}</Text>
          </View>
        ))}
        <View style={styles.totalsRow} wrap={false}>
          <Text style={styles.cName}>Gesamt</Text>
          <Text style={styles.cSport}> </Text>
          <Text style={styles.cVerband}> </Text>
          <Text style={styles.cNum}>{data.perAbteilung.reduce((s, a) => s + a.male, 0)}</Text>
          <Text style={styles.cNum}>{data.perAbteilung.reduce((s, a) => s + a.female, 0)}</Text>
          <Text style={styles.cNum}>{data.perAbteilung.reduce((s, a) => s + a.divers, 0)}</Text>
          <Text style={styles.cNum}>{data.grandTotal}</Text>
        </View>

        <Text style={styles.sectionTitle}>Aufschlüsselung nach Altersgruppe</Text>
        <AgeBreakdown data={data} />

        <View style={styles.signature} wrap={false}>
          <View style={styles.sigBox}>
            <View style={styles.sigLine} />
            <Text>Ort, Datum</Text>
          </View>
          <View style={styles.sigBox}>
            <View style={styles.sigLine} />
            <Text>Unterschrift Vorstand</Text>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Bestandserhebung ${docRef} · Seite ${pageNumber} von ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

const AGE_LABELS: ReadonlyArray<{
  bucket: "0-6" | "7-14" | "15-18" | "19-26" | "27-40" | "41-60" | "61+" | "unbekannt";
  label: string;
}> = [
  { bucket: "0-6", label: "0-6" },
  { bucket: "7-14", label: "7-14" },
  { bucket: "15-18", label: "15-18" },
  { bucket: "19-26", label: "19-26" },
  { bucket: "27-40", label: "27-40" },
  { bucket: "41-60", label: "41-60" },
  { bucket: "61+", label: "61+" },
  { bucket: "unbekannt", label: "unbek." },
];

function AgeBreakdown({ data }: { data: BestandserhebungBreakdown }) {
  const abteilungIds = data.perAbteilung.map((a) => a.abteilungId);
  const sums = new Map<string, Map<string, number>>();
  for (const id of abteilungIds) sums.set(id, new Map());
  for (const c of data.cells) {
    const m = sums.get(c.abteilungId);
    if (!m) continue;
    m.set(c.ageBucket, (m.get(c.ageBucket) ?? 0) + c.count);
  }

  return (
    <View>
      <View style={styles.tableHeader} wrap={false}>
        <Text style={styles.cName}>Abteilung</Text>
        {AGE_LABELS.map((a) => (
          <Text key={a.bucket} style={styles.cNum}>
            {a.label}
          </Text>
        ))}
        <Text style={styles.cNum}>Σ</Text>
      </View>
      {data.perAbteilung.map((a) => {
        const m = sums.get(a.abteilungId);
        return (
          <View key={a.abteilungId} style={styles.tableRow} wrap={false}>
            <Text style={styles.cName}>{a.abteilungName}</Text>
            {AGE_LABELS.map((b) => (
              <Text key={b.bucket} style={styles.cNum}>
                {m?.get(b.bucket) ?? 0}
              </Text>
            ))}
            <Text style={styles.cNum}>{a.total}</Text>
          </View>
        );
      })}
    </View>
  );
}
