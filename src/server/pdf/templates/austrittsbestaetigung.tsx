import { Document, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { CancellationModel } from "~/server/pdf/cancellation-model";
import { LetterPage } from "~/server/pdf/letter-layout";

const styles = StyleSheet.create({
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

export type AustrittsbestaetigungProps = { model: CancellationModel; docRef: string };

export function AustrittsbestaetigungDocument({ model, docRef }: AustrittsbestaetigungProps) {
  const { club, recipient } = model;
  const contact = club.kontaktEmail || club.kontaktTelefon;
  const hasLinks = Boolean(club.datenschutzUrl || club.satzungUrl);

  const returnLine =
    [
      club.vereinsname,
      club.anschriftStrasse,
      [club.anschriftPlz, club.anschriftOrt].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" · ") || `${club.vereinsname} · ${club.ort}`;
  const recipientLines = [
    recipient.anredeZeile,
    recipient.name,
    recipient.strasse,
    recipient.plzOrt,
  ].filter((l) => l.trim() !== "");
  // ortDatum reads "Ort, den DD.MM.YYYY"; the info block only needs the date.
  const datum = model.ortDatum.replace(/^.*?,\s*den\s*/, "");
  const infoRows = [
    ...(model.member.mitgliedsnummer
      ? [{ label: "Mitgliedsnummer", value: model.member.mitgliedsnummer }]
      : []),
    ...(model.legacyMitgliedsnummer
      ? [{ label: "Mitgliedsnummer (alt)", value: model.legacyMitgliedsnummer }]
      : []),
    { label: "Dokument", value: docRef },
    { label: "Datum", value: datum },
  ];

  return (
    <Document title={`Austrittsbestaetigung ${docRef}`}>
      <LetterPage
        logoDataUri={club.logoDataUri}
        orgName={club.vereinsname}
        returnLine={returnLine}
        recipientLines={recipientLines}
        infoRows={infoRows}
        subject={model.subject}
        footerText={`${club.vereinsname} · Dokument ${docRef}`}
      >
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
      </LetterPage>
    </Document>
  );
}
