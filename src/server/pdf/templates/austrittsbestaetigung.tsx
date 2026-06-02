import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { CancellationModel } from "~/server/pdf/cancellation-model";

const ACCENT = "#b91c1c";

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.45 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderColor: ACCENT,
    paddingBottom: 10,
    marginBottom: 22,
  },
  clubName: { fontFamily: "Helvetica-Bold", fontSize: 15, color: ACCENT },
  logo: { height: 52, objectFit: "contain" },
  recipient: { marginBottom: 26, lineHeight: 1.5 },
  meta: { textAlign: "right", marginBottom: 24, fontSize: 9.5, color: "#555" },
  subject: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 16 },
  para: { marginBottom: 12, textAlign: "left" },
  detailBox: {
    borderWidth: 0.5,
    borderColor: "#ddd",
    borderRadius: 4,
    backgroundColor: "#fafafa",
    padding: 12,
    marginVertical: 14,
  },
  detailRow: { flexDirection: "row", marginBottom: 3 },
  detailLabel: { width: 130, fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  detailValue: { flex: 1, fontSize: 9.5 },
  bold: { fontFamily: "Helvetica-Bold" },
  infoBlock: { marginTop: 22, fontSize: 8.5, color: "#444", lineHeight: 1.45 },
  hr: { borderTopWidth: 0.5, borderColor: "#ccc", marginBottom: 12 },
  infoHeading: { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: "#1a1a1a", marginBottom: 6 },
  infoPara: { marginBottom: 6 },
  closing: { marginTop: 28 },
  signLine: { marginTop: 18, fontSize: 9 },
});

export type AustrittsbestaetigungProps = { model: CancellationModel };

export function AustrittsbestaetigungDocument({ model }: AustrittsbestaetigungProps) {
  const { club, recipient } = model;
  const contact = club.kontaktEmail || club.kontaktTelefon;
  const hasLinks = Boolean(club.datenschutzUrl || club.satzungUrl);

  return (
    <Document title={`Austrittsbestaetigung ${model.displayName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.clubName}>{club.vereinsname}</Text>
          {club.logoDataUri ? <Image src={club.logoDataUri} style={styles.logo} /> : null}
        </View>

        <View style={styles.recipient}>
          {recipient.anredeZeile ? <Text>{recipient.anredeZeile}</Text> : null}
          <Text>{recipient.name}</Text>
          {recipient.strasse ? <Text>{recipient.strasse}</Text> : null}
          {recipient.plzOrt ? <Text>{recipient.plzOrt}</Text> : null}
        </View>

        <Text style={styles.meta}>{model.ortDatum}</Text>

        <Text style={styles.subject}>{model.subject}</Text>

        <Text style={styles.para}>{model.anrede}</Text>
        <Text style={styles.para}>{model.bodyIntro}</Text>

        <View style={styles.detailBox}>
          {model.isFamily ? (
            <>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Hauptmitglied:</Text>
                <Text style={styles.detailValue}>
                  {model.member.vorname} {model.member.nachname}
                  {model.member.geburtsdatum ? ` (geb. ${model.member.geburtsdatum})` : ""}
                  {model.member.mitgliedsnummer ? `, Nr. ${model.member.mitgliedsnummer}` : ""}
                </Text>
              </View>
              {model.familienmitglieder.map((fm, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static one-shot render of a frozen list; order is the identity.
                <View style={styles.detailRow} key={`fm-${i}`}>
                  <Text style={styles.detailLabel}>Familienmitglied {i + 1}:</Text>
                  <Text style={styles.detailValue}>
                    {fm.vorname} {fm.nachname}
                    {fm.geburtsdatum ? ` (geb. ${fm.geburtsdatum})` : ""}
                    {fm.mitgliedsnummer ? `, Nr. ${fm.mitgliedsnummer}` : ""}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Mitglied:</Text>
                <Text style={styles.detailValue}>
                  {model.member.vorname} {model.member.nachname}
                </Text>
              </View>
              {model.member.geburtsdatum ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Geburtsdatum:</Text>
                  <Text style={styles.detailValue}>{model.member.geburtsdatum}</Text>
                </View>
              ) : null}
              {model.member.mitgliedsnummer ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Mitgliedsnummer:</Text>
                  <Text style={styles.detailValue}>{model.member.mitgliedsnummer}</Text>
                </View>
              ) : null}
            </>
          )}
          {model.abteilung ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Abteilung(en):</Text>
              <Text style={styles.detailValue}>{model.abteilung}</Text>
            </View>
          ) : null}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Austritt zum:</Text>
            <Text style={[styles.detailValue, styles.bold]}>{model.austrittDatum}</Text>
          </View>
        </View>

        <Text style={styles.para}>{model.bodyClause}</Text>
        <Text style={styles.para}>{model.bodyThanks}</Text>

        <View style={styles.infoBlock}>
          <View style={styles.hr} />
          <Text style={styles.infoHeading}>Datenschutz und weitere Informationen</Text>
          <Text style={styles.infoPara}>
            Ihre personenbezogenen Daten werden im Rahmen der Vereinsmitgliedschaft gemäß § 18
            unserer Vereinssatzung sowie den Vorgaben der Datenschutz-Grundverordnung (DS-GVO)
            verarbeitet. Nach Beendigung der Mitgliedschaft werden Ihre Daten entsprechend den
            gesetzlichen Aufbewahrungsfristen aufbewahrt und anschließend gelöscht.
          </Text>
          <Text style={styles.infoPara}>
            Sie haben jederzeit das Recht auf Auskunft über Ihre gespeicherten Daten sowie das Recht
            auf Berichtigung, Löschung oder Einschränkung der Verarbeitung. Unsere vollständige
            Datenschutzerklärung mit allen Informationen zu Ihren Rechten und zur Datenverarbeitung
            im Verein finden Sie auf unserer Website.
          </Text>
          {hasLinks ? (
            <Text style={styles.infoPara}>
              {club.datenschutzUrl ? `Datenschutzerklärung: ${club.datenschutzUrl}` : ""}
              {club.datenschutzUrl && club.satzungUrl ? "   |   " : ""}
              {club.satzungUrl ? `Vereinssatzung: ${club.satzungUrl}` : ""}
            </Text>
          ) : null}
          {contact ? (
            <Text style={styles.infoPara}>
              Bei Fragen zur Mitgliedschaft oder Ihren gespeicherten Daten stehen wir Ihnen gerne
              zur Verfügung:{" "}
              {[club.kontaktEmail, club.kontaktTelefon].filter(Boolean).join("   |   ")}
            </Text>
          ) : null}
        </View>

        <View style={styles.closing} wrap={false}>
          <Text>{model.closing}</Text>
          <Text style={styles.signLine}>Mitgliederverwaltung, {club.vereinsname}</Text>
        </View>
      </Page>
    </Document>
  );
}
