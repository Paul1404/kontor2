import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EhrungsurkundeModel } from "~/server/pdf/ehrungsurkunde-model";
import { pdfBoldFamily, pdfBoldWeight, pdfFamily } from "~/server/pdf/fonts";

/**
 * A4 portrait honor certificate. Unlike the mailed letters this is a centered,
 * framed document meant to be printed and handed over, so it does not use the
 * DIN 5008 letter scaffold. A double border frames the page; the club logo,
 * heading, honored name and appreciation sit centered, with two signature
 * lines at the foot. Kept free of em/en dashes per the house style.
 */

// Fallback when the club has no brand colour configured. This is the historic
// certificate red; clubs that set a `primaryColor` get their own colour instead
// (see ehrungsurkunde-model.ts), so the certificate matches the rest of the app.
const DEFAULT_BRAND = "#b91c1c";
const INK = "#1a1a1a";

const makeStyles = (brand: string) =>
  StyleSheet.create({
    page: {
      paddingVertical: 56,
      paddingHorizontal: 56,
      fontFamily: pdfFamily(),
      color: INK,
    },
    outerFrame: {
      position: "absolute",
      top: 28,
      left: 28,
      right: 28,
      bottom: 28,
      borderWidth: 2,
      borderColor: brand,
    },
    innerFrame: {
      position: "absolute",
      top: 34,
      left: 34,
      right: 34,
      bottom: 34,
      borderWidth: 0.75,
      borderColor: brand,
    },
    content: {
      flex: 1,
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: 24,
    },
    logo: { height: 64, objectFit: "contain", marginBottom: 18 },
    vereinKopf: {
      fontFamily: pdfBoldFamily(),
      fontWeight: pdfBoldWeight(),
      fontSize: 13,
      letterSpacing: 1,
      textAlign: "center",
      color: INK,
      marginBottom: 4,
    },
    rule: { width: 90, height: 2, backgroundColor: brand, marginVertical: 18 },
    ueberschrift: {
      fontFamily: pdfBoldFamily(),
      fontWeight: pdfBoldWeight(),
      fontSize: 36,
      letterSpacing: 3,
      color: brand,
      textAlign: "center",
      marginBottom: 10,
    },
    verleihtZeile: { fontSize: 12, color: "#444", textAlign: "center", marginTop: 14 },
    empfaenger: {
      fontFamily: pdfBoldFamily(),
      fontWeight: pdfBoldWeight(),
      fontSize: 26,
      color: INK,
      textAlign: "center",
      marginTop: 14,
      marginBottom: 14,
    },
    ehrungTitelLabel: { fontSize: 11, color: "#666", textAlign: "center" },
    ehrungTitel: {
      fontFamily: pdfBoldFamily(),
      fontWeight: pdfBoldWeight(),
      fontSize: 18,
      color: brand,
      textAlign: "center",
      marginTop: 4,
    },
    wuerdigung: {
      fontSize: 12,
      lineHeight: 1.6,
      color: "#333",
      textAlign: "center",
      marginTop: 22,
      maxWidth: 360,
    },
    ortDatum: { fontSize: 11, color: "#444", textAlign: "center", marginTop: 36 },
    signRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
      marginTop: 56,
      paddingHorizontal: 8,
    },
    signCol: { width: 180, alignItems: "center" },
    signLine: { width: 160, borderTopWidth: 0.75, borderColor: "#777", paddingTop: 4 },
    signLabel: { fontSize: 9, color: "#555", textAlign: "center" },
    footer: {
      position: "absolute",
      bottom: 40,
      left: 56,
      right: 56,
      fontSize: 7.5,
      color: "#999",
      textAlign: "center",
    },
  });

export type EhrungsurkundeProps = { model: EhrungsurkundeModel };

export function EhrungsurkundeDocument({ model }: EhrungsurkundeProps) {
  const styles = makeStyles(model.brandColor || DEFAULT_BRAND);
  return (
    <Document
      title={`Ehrenurkunde ${model.docRef} · ${model.empfaengerName}`}
      author={model.vereinsname}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.outerFrame} fixed />
        <View style={styles.innerFrame} fixed />

        <View style={styles.content}>
          {model.logoDataUri ? <Image src={model.logoDataUri} style={styles.logo} /> : null}
          <Text style={styles.vereinKopf}>{model.vereinsname}</Text>

          <View style={styles.rule} />

          <Text style={styles.ueberschrift}>{model.ueberschrift}</Text>

          <Text style={styles.verleihtZeile}>{model.verleihtZeile}</Text>
          <Text style={styles.empfaenger}>{model.empfaengerName}</Text>

          <Text style={styles.ehrungTitelLabel}>die Ehrung</Text>
          <Text style={styles.ehrungTitel}>{model.ehrungTitel}</Text>

          <Text style={styles.wuerdigung}>{model.wuerdigung}</Text>

          <Text style={styles.ortDatum}>{model.ortDatumZeile}</Text>

          <View style={styles.signRow}>
            <View style={styles.signCol}>
              <View style={styles.signLine}>
                <Text style={styles.signLabel}>{model.unterschriftLinks}</Text>
              </View>
            </View>
            <View style={styles.signCol}>
              <View style={styles.signLine}>
                <Text style={styles.signLabel}>{model.unterschriftRechts}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          {model.vereinsname} · Dokument {model.docRef}
          {model.legacyMitgliedsnummer
            ? ` · Mitgliedsnummer (alt) ${model.legacyMitgliedsnummer}`
            : ""}
        </Text>
      </Page>
    </Document>
  );
}
