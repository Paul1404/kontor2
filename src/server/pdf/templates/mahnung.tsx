import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: "Helvetica", color: "#111", lineHeight: 1.4 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logo: { height: 52, objectFit: "contain" },
  orgBlock: { alignItems: "flex-end", fontSize: 8, color: "#555", maxWidth: 220 },
  orgName: { fontFamily: "Helvetica-Bold", fontSize: 10, color: "#111", marginBottom: 2 },
  senderLine: {
    fontSize: 7,
    color: "#777",
    borderBottomWidth: 0.5,
    borderColor: "#ccc",
    paddingBottom: 2,
    marginBottom: 4,
  },
  recipient: { marginTop: 4, marginBottom: 36 },
  vertretung: { fontSize: 8, color: "#555" },
  meta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  metaItem: { fontSize: 9 },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  intro: { marginBottom: 10 },
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
  c1: { flex: 1.2 },
  c2: { flex: 2.4 },
  c3: { flex: 1, textAlign: "right" },
  c4: { flex: 1, textAlign: "right" },
  notice: {
    marginTop: 14,
    padding: 10,
    backgroundColor: "#fff7ed",
    borderLeftWidth: 2,
    borderColor: "#d97706",
    fontSize: 9.5,
  },
  paymentBox: {
    marginTop: 14,
    padding: 10,
    borderWidth: 0.5,
    borderColor: "#999",
    fontSize: 9.5,
  },
  paymentRow: { flexDirection: "row", marginBottom: 2 },
  paymentKey: { width: 110, color: "#555" },
  paymentValue: { flex: 1, fontFamily: "Helvetica-Bold" },
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

type MahnungPosting = {
  billingYear: number;
  falligkeitsdatum: string;
  description: string;
  openAmount: string;
  rueckgebuhr: string;
};

export type MahnungInput = {
  level: 1 | 2 | 3;
  runDate: string;
  dueDate: string;
  organization: {
    vereinsname: string;
    anschriftStrasse: string | null;
    anschriftPlz: string | null;
    anschriftOrt: string | null;
    /** Full club IBAN. Shown in full so the member can actually pay. */
    vereinsIban: string;
    vereinsBic: string;
    vereinsBankname: string | null;
    glaeubigerId: string;
    /** Club logo as a data URI, or null to render without one. */
    logoDataUri: string | null;
  };
  /** The member the dues belong to (drives Mitgliedsnummer + Verwendungszweck). */
  member: {
    mitglnr: string | null;
    adrNr: number;
    vorname: string | null;
    nachname: string | null;
    kurzname: string | null;
    firma1: string | null;
  };
  /** Who the letter is addressed to (the member, or their legal guardian). */
  recipient: {
    anrede: string | null;
    name: string;
    strasse: string | null;
    hausnummer: string | null;
    plz: string | null;
    ort: string | null;
    /** Set when the recipient is a guardian: name of the member they represent. */
    vertretungFor: string | null;
  };
  postings: MahnungPosting[];
  openSum: string;
  mahngebuhr: string;
  totalDue: string;
};

const LEVEL_TITLES: Record<1 | 2 | 3, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

const LEVEL_INTROS: Record<1 | 2 | 3, string> = {
  1: "bei der Überprüfung unserer Buchhaltung haben wir festgestellt, dass die nachfolgend aufgeführten Beiträge bisher noch nicht beglichen wurden. Möglicherweise ist Ihnen dies entgangen. Wir bitten um Ausgleich des Betrags bis spätestens",
  2: "trotz unserer Zahlungserinnerung sind die nachfolgend aufgeführten Beiträge weiterhin offen. Wir bitten Sie nun nachdrücklich, den ausstehenden Betrag bis spätestens",
  3: "leider mussten wir feststellen, dass auch nach unserer 1. Mahnung die offenen Beiträge bislang nicht beglichen wurden. Bitte überweisen Sie den fälligen Gesamtbetrag bis spätestens",
};

const LEVEL_CLOSING: Record<1 | 2 | 3, string> = {
  1: "Sollte sich Ihre Zahlung mit dieser Erinnerung überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
  2: "Bitte beachten Sie, dass wir die Sache im Falle weiterer Nichtzahlung an den Vorstand zur Klärung weiterleiten müssen.",
  3: "Sollte auch nach Ablauf dieser Frist keine Zahlung erfolgen, behält sich der Verein die Einleitung weiterer Schritte einschließlich der Beendigung der Mitgliedschaft vor.",
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

/** Group an IBAN into blocks of four for readability. */
function fmtIban(s: string): string {
  const clean = (s ?? "").replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function subjectName(m: MahnungInput["member"]): string {
  const full = [m.vorname, m.nachname].filter(Boolean).join(" ").trim();
  return full || m.kurzname || m.firma1 || `Mitglied ${m.mitglnr ?? m.adrNr}`;
}

function salutation(r: MahnungInput["recipient"]): string {
  if (r.anrede === "Herr") return `Sehr geehrter Herr ${lastWord(r.name)}`;
  if (r.anrede === "Frau") return `Sehr geehrte Frau ${lastWord(r.name)}`;
  return "Sehr geehrte Damen und Herren";
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

export function MahnungDocument({ pkg, docRef }: { pkg: MahnungInput; docRef: string }) {
  const org = pkg.organization;
  const senderLine = [
    org.vereinsname,
    org.anschriftStrasse,
    [org.anschriftPlz, org.anschriftOrt].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  const title = LEVEL_TITLES[pkg.level];
  const subject = subjectName(pkg.member);
  const r = pkg.recipient;
  const recipientLines = [
    r.name,
    [r.strasse, r.hausnummer].filter(Boolean).join(" "),
    [r.plz, r.ort].filter(Boolean).join(" "),
  ].filter(Boolean);

  return (
    <Document title={`${title} ${docRef}`} author={org.vereinsname}>
      <Page size="A4" style={styles.page} wrap>
        {/* Letterhead: logo plus the club wordmark. The postal address is
            deliberately not repeated here -- it appears once in the sender
            line below, which is the return address for window envelopes. */}
        <View style={styles.headerRow}>
          {org.logoDataUri ? <Image src={org.logoDataUri} style={styles.logo} /> : <View />}
          <View style={styles.orgBlock}>
            <Text style={styles.orgName}>{org.vereinsname}</Text>
          </View>
        </View>

        <View style={styles.recipient}>
          <Text style={styles.senderLine}>{senderLine}</Text>
          {recipientLines.map((line, i) => (
            <Text key={String(i)}>{line}</Text>
          ))}
          {r.vertretungFor ? (
            <Text style={styles.vertretung}>gesetzliche Vertretung von {r.vertretungFor}</Text>
          ) : null}
        </View>

        <View style={styles.meta}>
          <Text style={styles.metaItem}>
            Mitgliedsnummer: {pkg.member.mitglnr ?? `AdrNr ${pkg.member.adrNr}`}
          </Text>
          <Text style={styles.metaItem}>Dokument: {docRef}</Text>
          <Text style={styles.metaItem}>Datum: {fmtDate(pkg.runDate)}</Text>
        </View>

        <Text style={styles.h1}>{title}</Text>

        <Text style={styles.intro}>{salutation(r)},</Text>
        {r.vertretungFor ? (
          <Text style={styles.intro}>
            als gesetzliche Vertretung von {r.vertretungFor} erhalten Sie dieses Schreiben.
          </Text>
        ) : null}
        <Text style={styles.intro}>
          {LEVEL_INTROS[pkg.level]} {fmtDate(pkg.dueDate)} zu begleichen.
        </Text>

        <View style={styles.table}>
          <View style={styles.tableHeader} wrap={false}>
            <Text style={styles.c1}>Jahr / Fällig</Text>
            <Text style={styles.c2}>Bezeichnung</Text>
            <Text style={styles.c3}>R-Geb.</Text>
            <Text style={styles.c4}>Offen</Text>
          </View>
          {pkg.postings.map((p, i) => (
            <View key={String(i)} style={styles.tableRow} wrap={false}>
              <Text style={styles.c1}>
                {p.billingYear} · {fmtDate(p.falligkeitsdatum)}
              </Text>
              <Text style={styles.c2}>{p.description}</Text>
              <Text style={styles.c3}>{fmtMoney(p.rueckgebuhr)}</Text>
              <Text style={styles.c4}>{fmtMoney(p.openAmount)}</Text>
            </View>
          ))}
          <View style={styles.tableRow}>
            <Text style={styles.c1}> </Text>
            <Text style={styles.c2}>Summe offener Beträge</Text>
            <Text style={styles.c3}> </Text>
            <Text style={styles.c4}>{fmtMoney(pkg.openSum)} €</Text>
          </View>
          {Number.parseFloat(pkg.mahngebuhr) > 0 ? (
            <View style={styles.tableRow}>
              <Text style={styles.c1}> </Text>
              <Text style={styles.c2}>{title} – Mahngebühr</Text>
              <Text style={styles.c3}> </Text>
              <Text style={styles.c4}>{fmtMoney(pkg.mahngebuhr)} €</Text>
            </View>
          ) : null}
          <View style={styles.totalsRow}>
            <Text style={styles.c1}> </Text>
            <Text style={styles.c2}>Gesamtbetrag</Text>
            <Text style={styles.c3}> </Text>
            <Text style={styles.c4}>{fmtMoney(pkg.totalDue)} €</Text>
          </View>
        </View>

        <View style={styles.paymentBox}>
          <Text style={{ marginBottom: 4, fontFamily: "Helvetica-Bold" }}>Bankverbindung</Text>
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
              {title} · {subject} · Mitgliedsnr {pkg.member.mitglnr ?? pkg.member.adrNr}
            </Text>
          </View>
        </View>

        <View style={styles.notice}>
          <Text>{LEVEL_CLOSING[pkg.level]}</Text>
        </View>

        <Text style={{ marginTop: 18 }}>Mit freundlichen Grüßen</Text>
        <Text style={{ marginTop: 24 }}>{org.vereinsname}</Text>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${org.vereinsname} · Dokument ${docRef} · Gläubiger-ID ${org.glaeubigerId} · Seite ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
