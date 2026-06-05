import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AuskunftsPackage } from "~/server/dsgvo/auskunft";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111",
    lineHeight: 1.4,
  },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 4 },
  meta: { fontSize: 8, color: "#555", marginBottom: 12 },
  notice: {
    backgroundColor: "#f4f4f5",
    padding: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#999",
    marginBottom: 12,
  },
  row: { flexDirection: "row", marginBottom: 1 },
  key: { width: 140, color: "#555" },
  value: { flex: 1 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#999",
    paddingBottom: 2,
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    paddingVertical: 2,
  },
  cell: { flex: 1, paddingRight: 4 },
  footer: { position: "absolute", bottom: 18, left: 36, right: 36, fontSize: 7, color: "#777" },
});

function fmt(value: unknown): string {
  if (value == null) return "—";
  if (value instanceof Date) return value.toLocaleString("de-DE");
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const s = JSON.stringify(value);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  }
  return String(value);
}

const MEMBER_FIELD_LABELS: Array<[string, string]> = [
  ["mitgliedsnummer", "Mitgliedsnummer"],
  ["adrNr", "Adressnummer (Legacy)"],
  ["anrede", "Anrede"],
  ["titel1", "Titel"],
  ["vorname", "Vorname"],
  ["nachname", "Nachname"],
  ["geschlecht", "Geschlecht"],
  ["geburtsdatum", "Geburtsdatum"],
  ["geburtsort", "Geburtsort"],
  ["strasse", "Straße"],
  ["hausnummer", "Hausnummer"],
  ["plz", "PLZ"],
  ["ort", "Ort"],
  ["land", "Land"],
  ["telefon1", "Telefon"],
  ["telefon2", "Telefon 2"],
  ["email", "E-Mail"],
  ["www", "Webseite"],
  ["eintritt", "Vereinseintritt"],
  ["austritt", "Vereinsaustritt"],
  ["aktivPasiv", "Aktiv/Passiv"],
  ["iban1", "IBAN (maskiert)"],
  ["bic1", "BIC"],
];

export function AuskunftDocument({ pkg, docRef }: { pkg: AuskunftsPackage; docRef: string }) {
  const member = pkg.member;
  return (
    <Document title={`DSGVO-Auskunft ${docRef}`} author="SVUWV">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.h1}>Auskunft nach Art. 15 DSGVO</Text>
        <Text style={styles.meta}>
          Dokument {docRef} · Erstellt am {new Date(pkg.generatedAt).toLocaleString("de-DE")} ·
          Mitglied {pkg.generatedFor.mitgliedsnummer ?? "—"} · Datei-Hash siehe Begleitschreiben
        </Text>

        <View style={styles.notice}>
          <Text>{pkg.notice}</Text>
        </View>

        <Text style={styles.h2}>Stammdaten</Text>
        <View>
          {MEMBER_FIELD_LABELS.map(([key, label]) => (
            <View key={key} style={styles.row} wrap={false}>
              <Text style={styles.key}>{label}</Text>
              <Text style={styles.value}>{fmt(member[key])}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.h2}>Abteilungen / Mitgliedschaften</Text>
        {pkg.abteilungen.length === 0 ? (
          <Text>Keine Abteilungs-Mitgliedschaften erfasst.</Text>
        ) : (
          <View>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={styles.cell}>Abteilung</Text>
              <Text style={styles.cell}>Sportart</Text>
              <Text style={styles.cell}>Eintritt</Text>
              <Text style={styles.cell}>Austritt</Text>
            </View>
            {pkg.abteilungen.map((a, i) => (
              <View key={String(i)} style={styles.tableRow} wrap={false}>
                <Text style={styles.cell}>{fmt(a.abteilungName)}</Text>
                <Text style={styles.cell}>{fmt(a.sportart)}</Text>
                <Text style={styles.cell}>{fmt(a.eintrittsdatum)}</Text>
                <Text style={styles.cell}>{fmt(a.austrittsdatum)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.h2}>Verträge ({pkg.contracts.length})</Text>
        {pkg.contracts.length === 0 ? (
          <Text>Keine Verträge erfasst.</Text>
        ) : (
          <View>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={styles.cell}>Vertrag-Nr.</Text>
              <Text style={styles.cell}>Art</Text>
              <Text style={styles.cell}>Beginn</Text>
              <Text style={styles.cell}>Ende</Text>
              <Text style={styles.cell}>Betrag</Text>
            </View>
            {pkg.contracts.map((c, i) => (
              <View key={String(i)} style={styles.tableRow} wrap={false}>
                <Text style={styles.cell}>{fmt(c.vertragNr)}</Text>
                <Text style={styles.cell}>{fmt(c.artName ?? c.art)}</Text>
                <Text style={styles.cell}>{fmt(c.vertragBegin)}</Text>
                <Text style={styles.cell}>{fmt(c.vertragEnde)}</Text>
                <Text style={styles.cell}>{fmt(c.betrag)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.h2}>SEPA-Mandate ({pkg.sepaMandates.length})</Text>
        {pkg.sepaMandates.length === 0 ? (
          <Text>Keine SEPA-Mandate hinterlegt.</Text>
        ) : (
          <View>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={styles.cell}>Mandats-Nr.</Text>
              <Text style={styles.cell}>Typ</Text>
              <Text style={styles.cell}>Unterschrift</Text>
              <Text style={styles.cell}>Letzte Verwendung</Text>
            </View>
            {pkg.sepaMandates.map((s, i) => (
              <View key={String(i)} style={styles.tableRow} wrap={false}>
                <Text style={styles.cell}>{fmt(s.mandatsNr)}</Text>
                <Text style={styles.cell}>{fmt(s.typ)}</Text>
                <Text style={styles.cell}>{fmt(s.unterschriftDatum)}</Text>
                <Text style={styles.cell}>{fmt(s.letzteVerwendung)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.h2}>Beiträge ({pkg.fees.length})</Text>
        {pkg.fees.length === 0 ? (
          <Text>Keine Beitragsstellungen erfasst.</Text>
        ) : (
          <View>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={styles.cell}>Jahr</Text>
              <Text style={styles.cell}>Fälligkeit</Text>
              <Text style={styles.cell}>Soll</Text>
              <Text style={styles.cell}>Bezahlt</Text>
              <Text style={styles.cell}>Offen</Text>
              <Text style={styles.cell}>Status</Text>
            </View>
            {pkg.fees.map((f, i) => (
              <View key={String(i)} style={styles.tableRow} wrap={false}>
                <Text style={styles.cell}>{fmt(f.billingYear)}</Text>
                <Text style={styles.cell}>{fmt(f.falligkeitsdatum)}</Text>
                <Text style={styles.cell}>{fmt(f.amount)}</Text>
                <Text style={styles.cell}>{fmt(f.paidAmount)}</Text>
                <Text style={styles.cell}>{fmt(f.openAmount)}</Text>
                <Text style={styles.cell}>{fmt(f.status)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.h2}>Dokumente ({pkg.attachments.length})</Text>
        {pkg.attachments.length === 0 ? (
          <Text>Keine Dokumente hochgeladen.</Text>
        ) : (
          <View>
            {pkg.attachments.map((a) => (
              <View key={a.id} style={styles.row} wrap={false}>
                <Text style={styles.key}>{a.filename}</Text>
                <Text style={styles.value}>
                  {a.mimeType} · {Math.round(a.sizeBytes / 1024)} KB · hochgeladen{" "}
                  {new Date(a.uploadedAt).toLocaleDateString("de-DE")}
                </Text>
              </View>
            ))}
            <Text style={[styles.meta, { marginTop: 6 }]}>
              Download-Links sind im JSON-Begleitdokument enthalten und 24 Stunden gültig.
            </Text>
          </View>
        )}

        <Text style={styles.h2}>Einwilligungen ({pkg.consentLog.length})</Text>
        {pkg.consentLog.length === 0 ? (
          <Text>Keine Einwilligungen dokumentiert.</Text>
        ) : (
          <View>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={styles.cell}>Typ</Text>
              <Text style={styles.cell}>Erteilt?</Text>
              <Text style={styles.cell}>Erfasst am</Text>
              <Text style={styles.cell}>Beleg</Text>
            </View>
            {pkg.consentLog.map((c, i) => (
              <View key={String(i)} style={styles.tableRow} wrap={false}>
                <Text style={styles.cell}>{fmt(c.consentType)}</Text>
                <Text style={styles.cell}>{c.granted ? "Ja" : "Nein"}</Text>
                <Text style={styles.cell}>{fmt(c.recordedAt)}</Text>
                <Text style={styles.cell}>{fmt(c.evidence)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.h2}>Aufbewahrungshinweise</Text>
        {pkg.meta.retentionNotes.map((n) => (
          <Text key={n} style={{ marginBottom: 2 }}>
            • {n}
          </Text>
        ))}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `SVUWV · DSGVO-Auskunft ${docRef} · Seite ${pageNumber} von ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
