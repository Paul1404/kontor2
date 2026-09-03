import { Document, StyleSheet, Text, View } from "@react-pdf/renderer";
import { altMitgliedsnummer, memberRef } from "~/server/domain/member";
import { pdfBoldFamily, pdfBoldWeight, pdfFamily } from "~/server/pdf/fonts";
import { LetterPage } from "~/server/pdf/letter-layout";

const styles = StyleSheet.create({
  intro: { marginBottom: 10 },
  table: { marginVertical: 10, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#999" },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#999",
    paddingVertical: 4,
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
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
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
  },
  c1: { flex: 1.4 },
  c2: { flex: 2.6 },
  c3: { flex: 1, textAlign: "right" },
  paymentBox: {
    marginTop: 14,
    padding: 10,
    borderWidth: 0.5,
    borderColor: "#999",
    fontSize: 9.5,
  },
  paymentRow: { flexDirection: "row", marginBottom: 2 },
  paymentKey: { width: 110, color: "#555" },
  paymentValue: { flex: 1, fontFamily: pdfBoldFamily(), fontWeight: pdfBoldWeight() },
});

type RechnungPosting = {
  billingYear: number;
  falligkeitsdatum: string;
  description: string;
  openAmount: string;
};

export type RechnungInput = {
  runDate: string;
  dueDate: string;
  organization: {
    vereinsname: string;
    anschriftStrasse: string | null;
    anschriftPlz: string | null;
    anschriftOrt: string | null;
    vereinsIban: string;
    vereinsBic: string;
    vereinsBankname: string | null;
    glaeubigerId: string;
    logoDataUri: string | null;
  };
  member: {
    memberNo: string | null;
    kontaktNo: string | null;
    mitgliedsnummer: string | null;
    adrNr: number;
    vorname: string | null;
    nachname: string | null;
    kurzname: string | null;
    firma1: string | null;
    anrede: string | null;
    strasse: string | null;
    hausnummer: string | null;
    plz: string | null;
    ort: string | null;
  };
  postings: RechnungPosting[];
  totalDue: string;
};

function fmtDate(s: string): string {
  if (!s || s.length < 10) return s;
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

function fmtMoney(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtIban(s: string): string {
  const clean = (s ?? "").replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function subjectName(m: RechnungInput["member"]): string {
  const full = [m.vorname, m.nachname].filter(Boolean).join(" ").trim();
  return full || m.kurzname || m.firma1 || `Mitglied ${memberRef(m)}`;
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function salutation(m: RechnungInput["member"], name: string): string {
  if (m.anrede === "Herr") return `Sehr geehrter Herr ${lastWord(name)}`;
  if (m.anrede === "Frau") return `Sehr geehrte Frau ${lastWord(name)}`;
  return "Sehr geehrte Damen und Herren";
}

export function RechnungDocument({ pkg, docRef }: { pkg: RechnungInput; docRef: string }) {
  const org = pkg.organization;
  const senderLine = [
    org.vereinsname,
    org.anschriftStrasse,
    [org.anschriftPlz, org.anschriftOrt].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  const subject = subjectName(pkg.member);
  const ref = memberRef(pkg.member);
  const altNr = altMitgliedsnummer(pkg.member.mitgliedsnummer, ref);
  const m = pkg.member;
  const recipientLines = [
    subject,
    [m.strasse, m.hausnummer].filter(Boolean).join(" "),
    [m.plz, m.ort].filter(Boolean).join(" "),
  ].filter(Boolean);

  return (
    <Document title={`Rechnung ${docRef}`} author={org.vereinsname}>
      <LetterPage
        logoDataUri={org.logoDataUri}
        orgName={org.vereinsname}
        returnLine={senderLine}
        recipientLines={recipientLines}
        recipientNote={null}
        infoRows={[
          {
            label: pkg.member.memberNo ? "Mitgliedsnummer" : "Kontaktnummer",
            value: ref,
          },
          ...(altNr ? [{ label: "Mitgliedsnummer (alt)", value: altNr }] : []),
          { label: "Rechnungsnummer", value: docRef },
          { label: "Datum", value: fmtDate(pkg.runDate) },
        ]}
        subject="Rechnung"
        footerText={`${org.vereinsname} · Rechnung ${docRef} · Gläubiger-ID ${org.glaeubigerId}`}
      >
        <Text style={styles.intro}>{salutation(m, subject)},</Text>
        <Text style={styles.intro}>
          anbei erhalten Sie die Rechnung über Ihren Mitgliedsbeitrag. Wir bitten um Überweisung des
          Gesamtbetrags auf das unten genannte Konto bis spätestens {fmtDate(pkg.dueDate)}.
        </Text>

        <View style={styles.table}>
          <View style={styles.tableHeader} wrap={false}>
            <Text style={styles.c1}>Jahr / Fällig</Text>
            <Text style={styles.c2}>Bezeichnung</Text>
            <Text style={styles.c3}>Betrag</Text>
          </View>
          {pkg.postings.map((p, i) => (
            <View key={String(i)} style={styles.tableRow} wrap={false}>
              <Text style={styles.c1}>
                {p.billingYear} · {fmtDate(p.falligkeitsdatum)}
              </Text>
              <Text style={styles.c2}>{p.description}</Text>
              <Text style={styles.c3}>{fmtMoney(p.openAmount)}</Text>
            </View>
          ))}
          <View style={styles.totalsRow}>
            <Text style={styles.c1}> </Text>
            <Text style={styles.c2}>Gesamtbetrag</Text>
            <Text style={styles.c3}>{fmtMoney(pkg.totalDue)} €</Text>
          </View>
        </View>

        <View style={styles.paymentBox}>
          <Text
            style={{ marginBottom: 4, fontFamily: pdfBoldFamily(), fontWeight: pdfBoldWeight() }}
          >
            Bankverbindung
          </Text>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentKey}>Empfänger</Text>
            <Text style={styles.paymentValue}>{org.vereinsname}</Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentKey}>IBAN</Text>
            <Text style={styles.paymentValue}>{fmtIban(org.vereinsIban)}</Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentKey}>BIC</Text>
            <Text style={styles.paymentValue}>{org.vereinsBic}</Text>
          </View>
          {org.vereinsBankname ? (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentKey}>Bank</Text>
              <Text style={styles.paymentValue}>{org.vereinsBankname}</Text>
            </View>
          ) : null}
          <View style={styles.paymentRow}>
            <Text style={styles.paymentKey}>Verwendung</Text>
            <Text style={styles.paymentValue}>
              Rechnung {docRef} · {subject} · Mitgliedsnr {ref}
              {altNr ? ` (alt ${altNr})` : ""}
            </Text>
          </View>
        </View>

        <Text style={{ marginTop: 18 }}>
          Sollte sich Ihre Zahlung mit dieser Rechnung überschnitten haben, betrachten Sie dieses
          Schreiben bitte als gegenstandslos.
        </Text>
        <Text style={{ marginTop: 18 }}>Mit freundlichen Grüßen</Text>
        <Text style={{ marginTop: 24 }}>{org.vereinsname}</Text>
      </LetterPage>
    </Document>
  );
}
