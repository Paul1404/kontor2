import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { BeitrittDetailRow, BeitrittModel } from "~/server/pdf/beitrittserklaerung-model";
import { pdfBoldFamily, pdfBoldWeight, pdfFamily } from "~/server/pdf/fonts";
import { FoldAndHoleMarks, mm } from "~/server/pdf/letter-layout";

const styles = StyleSheet.create({
  // The Beitrittserklärung is a form, not a window-envelope letter, so it keeps
  // its own letterhead and content. It does follow the DIN 5008 page geometry
  // (Schriftrand 25 mm links / 20 mm rechts, Falz- und Lochmarken, Fußzeile)
  // so it folds, files and looks consistent with the mailed letters.
  page: {
    paddingTop: mm(15),
    paddingBottom: mm(18),
    paddingLeft: mm(25),
    paddingRight: mm(20),
    fontFamily: pdfFamily(),
    fontSize: 10,
    color: "#1a1a1a",
    lineHeight: 1.4,
  },
  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16, gap: 12 },
  logo: { width: 46, height: 46, objectFit: "contain" },
  headerText: { flex: 1 },
  clubName: { fontFamily: pdfBoldFamily(), fontWeight: pdfBoldWeight(), fontSize: 13 },
  title: { fontSize: 11, color: "#444", marginTop: 2 },
  antragNr: { fontSize: 9, color: "#666", textAlign: "right" },
  para: { marginBottom: 8, textAlign: "left" },
  sectionHeading: {
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
    fontSize: 10,
    marginTop: 14,
    marginBottom: 6,
    color: "#1a1a1a",
  },
  detailBox: {
    borderWidth: 0.5,
    borderColor: "#ddd",
    borderRadius: 4,
    backgroundColor: "#fafafa",
    padding: 10,
  },
  detailRow: { flexDirection: "row", marginBottom: 3 },
  detailLabel: {
    width: 130,
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
    fontSize: 9,
  },
  detailValue: { flex: 1, fontSize: 9 },
  feeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  feeLabel: { fontFamily: pdfBoldFamily(), fontWeight: pdfBoldWeight() },
  small: { fontSize: 8.5, color: "#444", marginTop: 6, lineHeight: 1.45 },
  approvedNote: {
    marginTop: 14,
    fontFamily: pdfBoldFamily(),
    fontWeight: pdfBoldWeight(),
    fontSize: 9.5,
    color: "#15803d",
  },
  signBlock: { marginTop: 26, flexDirection: "row", gap: 24 },
  signCol: { flex: 1 },
  signImage: { height: 48, objectFit: "contain", marginBottom: 4 },
  signLine: {
    borderTopWidth: 0.5,
    borderColor: "#333",
    paddingTop: 3,
    fontSize: 8.5,
    color: "#444",
  },
  footer: {
    position: "absolute",
    bottom: mm(8),
    left: mm(25),
    right: mm(20),
    textAlign: "center",
    fontSize: 8,
    color: "#888",
    borderTopWidth: 0.5,
    borderColor: "#eee",
    paddingTop: 6,
  },
});

function DetailRows({ rows }: { rows: BeitrittDetailRow[] }) {
  return (
    <View style={styles.detailBox}>
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static one-shot render of a frozen list.
        <View style={styles.detailRow} key={`${r.label}-${i}`}>
          <Text style={styles.detailLabel}>{r.label}:</Text>
          <Text style={styles.detailValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export type BeitrittserklaerungProps = { model: BeitrittModel };

export function BeitrittserklaerungDocument({ model }: BeitrittserklaerungProps) {
  const { club } = model;
  return (
    <Document title={`Beitrittserklaerung ${model.antragsnummer}`}>
      <Page size="A4" style={styles.page} wrap>
        <FoldAndHoleMarks />
        <View style={styles.header}>
          {club.logoDataUri ? <Image src={club.logoDataUri} style={styles.logo} /> : null}
          <View style={styles.headerText}>
            <Text style={styles.clubName}>{club.vereinsname}</Text>
            <Text style={styles.title}>{model.titel}</Text>
          </View>
          <View>
            <Text style={styles.antragNr}>Antragsnr.: {model.antragsnummer}</Text>
            <Text style={styles.antragNr}>Datum: {model.datum}</Text>
          </View>
        </View>

        <Text style={styles.para}>{model.anrede}</Text>
        <Text style={styles.para}>
          hiermit beantrage ich die Mitgliedschaft beim {club.vereinsname}.
        </Text>

        <Text style={styles.sectionHeading}>Antragsteller/in</Text>
        <DetailRows rows={model.applicantRows} />

        {model.guardianRows.length > 0 ? (
          <>
            <Text style={styles.sectionHeading}>Gesetzliche Vertretung</Text>
            <DetailRows rows={model.guardianRows} />
          </>
        ) : null}

        {model.partnerRows.length > 0 ? (
          <>
            <Text style={styles.sectionHeading}>Partner / 2. Elternteil</Text>
            <DetailRows rows={model.partnerRows} />
          </>
        ) : null}

        {model.kinder.length > 0 ? (
          <>
            <Text style={styles.sectionHeading}>Kinder</Text>
            <View style={styles.detailBox}>
              {model.kinder.map((k, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static one-shot render of a frozen list.
                <View style={styles.detailRow} key={`kind-${i}`}>
                  <Text style={styles.detailLabel}>Kind {i + 1}:</Text>
                  <Text style={styles.detailValue}>
                    {k.name}
                    {k.geburtsdatum ? ` (geb. ${k.geburtsdatum})` : ""}
                    {k.abteilungen ? `, ${k.abteilungen}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionHeading}>Mitgliedschaft</Text>
        <View style={styles.detailBox}>
          {model.abteilungen ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Abteilungen:</Text>
              <Text style={styles.detailValue}>{model.abteilungen}</Text>
            </View>
          ) : null}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Kategorie:</Text>
            <Text style={styles.detailValue}>{model.mitgliedschaftLabel}</Text>
          </View>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Jahresbeitrag</Text>
            <Text style={styles.feeLabel}>{model.jahresbeitrag} EUR</Text>
          </View>
        </View>

        <Text style={styles.sectionHeading}>SEPA-Lastschriftmandat</Text>
        <DetailRows rows={model.sepaRows} />
        <Text style={styles.small}>{model.mandatstext}</Text>

        <Text style={styles.small}>{model.consentText}</Text>

        {model.approvedAt ? (
          <Text style={styles.approvedNote}>Genehmigt am {model.approvedAt}.</Text>
        ) : null}

        <View style={styles.signBlock} wrap={false}>
          <View style={styles.signCol}>
            {model.signatureDataUri ? (
              <Image src={model.signatureDataUri} style={styles.signImage} />
            ) : (
              <View style={{ height: 48 }} />
            )}
            <Text style={styles.signLine}>
              Unterschrift {model.unterschriftName ? `(${model.unterschriftName})` : ""}
            </Text>
          </View>
          <View style={styles.signCol}>
            {model.countersignatureDataUri ? (
              <Image src={model.countersignatureDataUri} style={styles.signImage} />
            ) : (
              <View style={{ height: 48 }} />
            )}
            <Text style={styles.signLine}>
              {model.countersignatureDataUri
                ? `Für den Verein${model.countersignerName ? ` (${model.countersignerName})` : ""}`
                : "Ort, Datum"}
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {club.vereinsname}
          {club.glaeubigerId ? ` · Gläubiger-ID ${club.glaeubigerId}` : ""} · Antrag{" "}
          {model.antragsnummer}
        </Text>
      </Page>
    </Document>
  );
}
