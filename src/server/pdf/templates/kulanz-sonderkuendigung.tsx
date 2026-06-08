import { Document, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Fragment } from "react";
import type { KulanzClubModel, KulanzLetterModel } from "~/server/pdf/kulanz-model";
import { LetterPage } from "~/server/pdf/letter-layout";

const styles = StyleSheet.create({
  para: { marginBottom: 7 },
  table: { marginVertical: 7, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#999" },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#999",
    paddingVertical: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    backgroundColor: "#f4f4f5",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderColor: "#ddd",
    paddingVertical: 2.5,
    fontSize: 9,
  },
  totalsRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderTopWidth: 0.5,
    borderColor: "#444",
    marginTop: 3,
    fontFamily: "Helvetica-Bold",
  },
  c1: { flex: 1.3 },
  c2: { flex: 2.4 },
  c3: { flex: 1, textAlign: "right" },
  kulanzBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#f0fdf4",
    borderLeftWidth: 2,
    borderColor: "#16a34a",
    fontSize: 9,
  },
  paymentBox: {
    marginTop: 8,
    padding: 8,
    borderWidth: 0.5,
    borderColor: "#999",
    fontSize: 9,
  },
  paymentRow: { flexDirection: "row", marginBottom: 1.5 },
  paymentKey: { width: 110, color: "#555" },
  paymentValue: { flex: 1, fontFamily: "Helvetica-Bold" },
  slipFieldRow: { flexDirection: "row", marginTop: 28, gap: 18 },
  slipField: {
    flex: 1,
    borderTopWidth: 0.5,
    borderColor: "#555",
    paddingTop: 3,
    fontSize: 8,
    color: "#555",
  },
  responseEmail: { marginTop: 22, color: "#555" },
});

export type KulanzDocumentProps = {
  club: KulanzClubModel;
  letters: KulanzLetterModel[];
  /** Human-readable document reference for this run, e.g. "KS-2026-0001". */
  docRef: string;
};

function footerText(club: KulanzClubModel, docRef: string): string {
  return `${club.vereinsname} · Dokument ${docRef} · Gläubiger-ID ${club.glaeubigerId}`;
}

function KulanzLetterPage({
  club,
  letter,
  docRef,
}: {
  club: KulanzClubModel;
  letter: KulanzLetterModel;
  docRef: string;
}) {
  return (
    <LetterPage
      logoDataUri={club.logoDataUri}
      orgName={club.vereinsname}
      returnLine={club.senderLine}
      recipientLines={letter.recipientLines}
      recipientNote={
        letter.vertretungFor ? `gesetzliche Vertretung von ${letter.vertretungFor}` : null
      }
      infoRows={[
        { label: letter.referenceLabel, value: letter.reference },
        { label: "Dokument", value: docRef },
        { label: "Datum", value: letter.datum },
      ]}
      subject="Zahlungserinnerung"
      footerText={footerText(club, docRef)}
    >
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
        {letter.rueckgebuhr ? (
          <View style={styles.tableRow} wrap={false}>
            <Text style={styles.c1}> </Text>
            <Text style={styles.c2}>SEPA-Gebühr</Text>
            <Text style={styles.c3}>{letter.rueckgebuhr}</Text>
          </View>
        ) : null}
        {letter.rueckgebuhrErlass ? (
          <View style={styles.tableRow} wrap={false}>
            <Text style={styles.c1}> </Text>
            <Text style={styles.c2}>SEPA-Gebühr (erlassen)</Text>
            <Text style={styles.c3}>{letter.rueckgebuhrErlass}</Text>
          </View>
        ) : null}
        <View style={styles.totalsRow}>
          <Text style={styles.c1}> </Text>
          <Text style={styles.c2}>Offener Gesamtbetrag</Text>
          <Text style={styles.c3}>{letter.openSum}</Text>
        </View>
      </View>

      {letter.feeWaiverNote ? <Text style={styles.para}>{letter.feeWaiverNote}</Text> : null}

      <View style={styles.paymentBox} wrap={false}>
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

      <View style={styles.kulanzBox} wrap={false}>
        <Text>{letter.kulanz}</Text>
        {letter.kulanzEmail ? <Text style={{ marginTop: 6 }}>{letter.kulanzEmail}</Text> : null}
      </View>

      <View wrap={false}>
        <Text style={{ marginTop: 10 }}>Mit freundlichen Grüßen</Text>
        <Text style={{ marginTop: 12 }}>{club.vereinsname}</Text>
      </View>
    </LetterPage>
  );
}

/**
 * Dedicated response page: a self-contained Kündigungsbestätigung the member
 * fills in, signs and returns. The Verein sits in the address field as the
 * recipient (so it shows through a window envelope when folded), with the
 * member as the Rücksendeangabe above it. Returning this form is not the only
 * way: when a contact mailbox is configured the member can instead send a
 * formless email, which counts as a cancellation on its own.
 */
function KulanzResponsePage({
  club,
  letter,
  docRef,
}: {
  club: KulanzClubModel;
  letter: KulanzLetterModel;
  docRef: string;
}) {
  return (
    <LetterPage
      logoDataUri={club.logoDataUri}
      orgName={club.vereinsname}
      returnLine={letter.recipientLines.join(" · ")}
      recipientLines={club.rueckantwort.adresseLines}
      infoRows={[
        { label: letter.referenceLabel, value: letter.reference },
        { label: "Dokument", value: docRef },
        { label: "Datum", value: letter.datum },
      ]}
      subject="Kündigungsbestätigung"
      footerText={footerText(club, docRef)}
    >
      <Text style={styles.para}>{letter.slip.intro}</Text>
      <Text style={styles.para}>{letter.slip.memberLine}</Text>
      <Text style={styles.para}>Kündigung zum:</Text>

      <View style={styles.slipFieldRow}>
        <Text style={styles.slipField}>Ort, Datum</Text>
        <Text style={styles.slipField}>Unterschrift</Text>
      </View>

      {club.rueckantwort.email ? (
        <Text style={[styles.para, styles.responseEmail]}>
          Sie müssen dieses Formular nicht zurücksenden. Eine formlose E-Mail an{" "}
          {club.rueckantwort.email} mit Ihrem Namen und Ihrer {letter.referenceLabel} gilt ebenso
          als Kündigung. Wenn Sie möchten, senden Sie die unterschriebene Kündigungsbestätigung per
          Post oder eingescannt per E-Mail.
        </Text>
      ) : null}
    </LetterPage>
  );
}

export function KulanzSonderkuendigungDocument({ club, letters, docRef }: KulanzDocumentProps) {
  return (
    <Document
      title={`Zahlungserinnerung (Kulanz) ${docRef} · ${letters.length} Schreiben`}
      author={club.vereinsname}
    >
      {letters.map((letter, i) => (
        // Each recipient gets two pages: the cover letter and a ready-to-return
        // Kündigungsbestätigung.
        <Fragment key={String(i)}>
          <KulanzLetterPage club={club} letter={letter} docRef={docRef} />
          <KulanzResponsePage club={club} letter={letter} docRef={docRef} />
        </Fragment>
      ))}
    </Document>
  );
}
