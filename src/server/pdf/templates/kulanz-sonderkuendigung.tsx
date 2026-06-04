import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { KulanzClubModel, KulanzLetterModel } from "~/server/pdf/kulanz-model";

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: "Helvetica", color: "#111", lineHeight: 1.4 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logo: { height: 52, objectFit: "contain" },
  orgBlock: { alignItems: "flex-end", maxWidth: 220 },
  orgName: { fontFamily: "Helvetica-Bold", fontSize: 10, color: "#111" },
  recipient: { marginTop: 4, marginBottom: 30 },
  senderLine: {
    fontSize: 7,
    color: "#777",
    borderBottomWidth: 0.5,
    borderColor: "#ccc",
    paddingBottom: 2,
    marginBottom: 4,
  },
  vertretung: { fontSize: 8, color: "#555" },
  meta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  metaItem: { fontSize: 9 },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  para: { marginBottom: 10 },
  table: { marginVertical: 10, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#999" },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#999",
    paddingVertical: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    backgroundColor: "#f4f4f5",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderColor: "#ddd",
    paddingVertical: 3,
    fontSize: 9,
  },
  totalsRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTopWidth: 0.5,
    borderColor: "#444",
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
  },
  c1: { flex: 1.3 },
  c2: { flex: 2.4 },
  c3: { flex: 1, textAlign: "right" },
  kulanzBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: "#f0fdf4",
    borderLeftWidth: 2,
    borderColor: "#16a34a",
    fontSize: 9.5,
  },
  paymentBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: "#999",
    fontSize: 9.5,
  },
  paymentRow: { flexDirection: "row", marginBottom: 2 },
  paymentKey: { width: 110, color: "#555" },
  paymentValue: { flex: 1, fontFamily: "Helvetica-Bold" },
  slip: {
    marginTop: 26,
    borderTopWidth: 1,
    borderColor: "#999",
    borderStyle: "dashed",
    paddingTop: 12,
  },
  slipHint: { fontSize: 7.5, color: "#777", marginBottom: 8 },
  slipTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  slipLine: { marginBottom: 8 },
  slipFieldRow: { flexDirection: "row", marginTop: 14, gap: 18 },
  slipField: {
    flex: 1,
    borderTopWidth: 0.5,
    borderColor: "#555",
    paddingTop: 3,
    fontSize: 8,
    color: "#555",
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 50,
    right: 50,
    borderTopWidth: 0.5,
    borderColor: "#bbb",
    paddingTop: 6,
    fontSize: 7,
    color: "#777",
    textAlign: "center",
  },
});

export type KulanzDocumentProps = {
  club: KulanzClubModel;
  letters: KulanzLetterModel[];
};

function KulanzLetterPage({ club, letter }: { club: KulanzClubModel; letter: KulanzLetterModel }) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.headerRow}>
        {club.logoDataUri ? <Image src={club.logoDataUri} style={styles.logo} /> : <View />}
        <View style={styles.orgBlock}>
          <Text style={styles.orgName}>{club.vereinsname}</Text>
        </View>
      </View>

      <View style={styles.recipient}>
        <Text style={styles.senderLine}>{club.senderLine}</Text>
        {letter.recipientLines.map((line, i) => (
          <Text key={String(i)}>{line}</Text>
        ))}
        {letter.vertretungFor ? (
          <Text style={styles.vertretung}>gesetzliche Vertretung von {letter.vertretungFor}</Text>
        ) : null}
      </View>

      <View style={styles.meta}>
        <Text style={styles.metaItem}>Mitgliedsnummer: {letter.mitgliedsnummer}</Text>
        <Text style={styles.metaItem}>Datum: {letter.datum}</Text>
      </View>

      <Text style={styles.h1}>Zahlungserinnerung</Text>

      <Text style={styles.para}>{letter.salutation}</Text>
      {letter.vertretungFor ? (
        <Text style={styles.para}>
          als gesetzliche Vertretung von {letter.vertretungFor} erhalten Sie dieses Schreiben.
        </Text>
      ) : null}
      <Text style={styles.para}>{letter.intro}</Text>

      <View style={styles.table}>
        <View style={styles.tableHeader} wrap={false}>
          <Text style={styles.c1}>Jahr / Fällig</Text>
          <Text style={styles.c2}>Bezeichnung</Text>
          <Text style={styles.c3}>Offen</Text>
        </View>
        {letter.postings.map((p, i) => (
          <View key={String(i)} style={styles.tableRow} wrap={false}>
            <Text style={styles.c1}>{p.jahrFaellig}</Text>
            <Text style={styles.c2}>{p.bezeichnung}</Text>
            <Text style={styles.c3}>{p.offen}</Text>
          </View>
        ))}
        <View style={styles.totalsRow}>
          <Text style={styles.c1}> </Text>
          <Text style={styles.c2}>Offener Gesamtbetrag</Text>
          <Text style={styles.c3}>{letter.openSum}</Text>
        </View>
      </View>

      <View style={styles.paymentBox}>
        <Text style={{ marginBottom: 4, fontFamily: "Helvetica-Bold" }}>Bankverbindung</Text>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentKey}>Empfänger</Text>
          <Text style={styles.paymentValue}>{club.bank.empfaenger}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentKey}>IBAN</Text>
          <Text style={styles.paymentValue}>{club.bank.iban}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentKey}>BIC</Text>
          <Text style={styles.paymentValue}>{club.bank.bic}</Text>
        </View>
        {club.bank.bankname ? (
          <View style={styles.paymentRow}>
            <Text style={styles.paymentKey}>Bank</Text>
            <Text style={styles.paymentValue}>{club.bank.bankname}</Text>
          </View>
        ) : null}
        <View style={styles.paymentRow}>
          <Text style={styles.paymentKey}>Verwendung</Text>
          <Text style={styles.paymentValue}>{letter.verwendungszweck}</Text>
        </View>
      </View>

      <View style={styles.kulanzBox}>
        <Text>{letter.kulanz}</Text>
      </View>

      <Text style={{ marginTop: 16 }}>Mit freundlichen Grüßen</Text>
      <Text style={{ marginTop: 20 }}>{club.vereinsname}</Text>

      {/* Tear-off Kündigungsbestätigung: the member signs and mails it back. */}
      <View style={styles.slip} wrap={false}>
        <Text style={styles.slipHint}>Bitte hier abtrennen und unterschrieben zurücksenden.</Text>
        <Text style={styles.slipTitle}>Kündigungsbestätigung</Text>
        <Text style={styles.slipLine}>{letter.slip.intro}</Text>
        <Text style={styles.slipLine}>{letter.slip.memberLine}</Text>
        <Text>Kündigung zum:</Text>
        <View style={styles.slipFieldRow}>
          <Text style={styles.slipField}>Ort, Datum</Text>
          <Text style={styles.slipField}>Unterschrift</Text>
        </View>
      </View>

      <Text
        style={styles.footer}
        render={({ pageNumber, totalPages }) =>
          `${club.vereinsname} · Gläubiger-ID ${club.glaeubigerId} · Seite ${pageNumber}/${totalPages}`
        }
        fixed
      />
    </Page>
  );
}

export function KulanzSonderkuendigungDocument({ club, letters }: KulanzDocumentProps) {
  return (
    <Document
      title={`Zahlungserinnerung (Kulanz) · ${letters.length} Schreiben`}
      author={club.vereinsname}
    >
      {letters.map((letter, i) => (
        <KulanzLetterPage key={String(i)} club={club} letter={letter} />
      ))}
    </Document>
  );
}
