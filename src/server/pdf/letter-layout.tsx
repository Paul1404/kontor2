import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { winAnsiSafe } from "~/server/pdf/winansi";

/**
 * Shared DIN 5008 (Form B) business-letter scaffold for the mailed letters
 * (Mahnung, Austrittsbestätigung, Kulanz-Brief). It fixes the geometry the
 * German norm requires so the documents fold and show through a DIN-lang window
 * envelope:
 *
 *   - Schriftrand: 25 mm links, 20 mm rechts.
 *   - Anschriftfeld: oben 45 mm, links 25 mm, 85 mm breit, 40 mm hoch, mit
 *     kleiner Rücksendeangabe darüber.
 *   - Informationsblock rechts (Datum, Dokument, Mitgliedsnummer).
 *   - Betreffzeile fett, Textbereich ab 98,46 mm.
 *   - Falzmarken (Form B, passend zum Anschriftfeld bei 45 mm) bei 105 mm und
 *     210 mm, Lochmarke bei 148,5 mm (Blattmitte).
 *   - Fußzeile auf jeder Seite.
 *
 * Document-specific content (tables, payment boxes, slips) lives in the callers
 * and is passed in as `children`; this file owns only the letter frame. Kept
 * free of em/en dashes per the house style.
 */

/** Millimetre to PDF point (1 mm = 72/25.4 pt). react-pdf styles are in pt. */
export const mm = (value: number): number => (value * 72) / 25.4;

const styles = StyleSheet.create({
  // The letterhead, address field, info block, fold marks and footer are placed
  // in absolute millimetres from the paper edge (react-pdf measures `top` from
  // the page edge, not the padding box). The page padding only governs flowing
  // body text: a 25 mm top so continuation pages keep a proper margin, and a
  // bottom reserve so text never collides with the Fußzeile. Page 1 pushes its
  // first line down to the DIN reference line via a lead spacer in the body.
  page: {
    paddingTop: mm(25),
    paddingBottom: mm(18),
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111",
    lineHeight: 1.4,
  },
  // Briefkopf: logo left, club wordmark right, within the 45 mm header band.
  header: {
    position: "absolute",
    top: mm(12),
    left: mm(25),
    right: mm(20),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logo: { height: mm(15), objectFit: "contain" },
  orgName: { fontFamily: "Helvetica-Bold", fontSize: 11, color: "#111", textAlign: "right" },
  // Anschriftfeld (DIN 676 Form B): 85 x 40 mm at 45/25 mm.
  addressField: {
    position: "absolute",
    top: mm(45),
    left: mm(25),
    width: mm(85),
    height: mm(40),
  },
  returnLine: {
    fontSize: 7,
    color: "#777",
    borderBottomWidth: 0.5,
    borderColor: "#bbb",
    paddingBottom: 2,
    marginBottom: 8,
  },
  recipientLine: { fontSize: 10, lineHeight: 1.3 },
  recipientNote: { fontSize: 8, color: "#555", marginTop: 2 },
  // Informationsblock, right-aligned column ending at the right margin.
  infoBlock: {
    position: "absolute",
    top: mm(50),
    left: mm(125),
    width: mm(65),
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  infoLabel: { fontSize: 8, color: "#666" },
  infoValue: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "right" },
  // Textbereich: 25 mm left / 20 mm right margins. A lead spacer drops the first
  // line to `bodyStartMm` (DIN reference line 98,46 mm by default) on page 1
  // only; on continuation pages the page padding (25 mm) carries the margin.
  body: { marginLeft: mm(25), marginRight: mm(20) },
  subject: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: mm(6) },
  // Falz- und Lochmarken at the very left edge.
  foldMark: {
    position: "absolute",
    left: 0,
    width: mm(5),
    height: 0.6,
    backgroundColor: "#999",
  },
  holeMark: {
    position: "absolute",
    left: 0,
    width: mm(7),
    height: 0.6,
    backgroundColor: "#999",
  },
  footer: {
    position: "absolute",
    bottom: mm(8),
    left: mm(25),
    right: mm(20),
    borderTopWidth: 0.5,
    borderColor: "#bbb",
    paddingTop: 5,
    fontSize: 7,
    color: "#777",
    textAlign: "center",
  },
});

/**
 * DIN 5008 Falz- und Lochmarken at the left paper edge. Form B (address field at
 * 45 mm): fold marks at 105 mm and 210 mm, hole mark at 148,5 mm (page middle).
 * Exported so non-letter documents (e.g. the
 * Beitrittserklärung form) can share the exact same filing geometry. `fixed` so
 * they repeat on every page.
 */
export function FoldAndHoleMarks() {
  return (
    <>
      <View style={[styles.foldMark, { top: mm(105) }]} fixed />
      <View style={[styles.holeMark, { top: mm(148.5) }]} fixed />
      <View style={[styles.foldMark, { top: mm(210) }]} fixed />
    </>
  );
}

export type LetterInfoRow = { label: string; value: string };

export type LetterPageProps = {
  logoDataUri: string | null;
  orgName: string;
  /** Rücksendeangabe shown small above the recipient, e.g. "Verein · Straße · PLZ Ort". */
  returnLine: string;
  recipientLines: string[];
  /** Small note under the address (e.g. legal-guardian line), or null. */
  recipientNote?: string | null;
  infoRows: LetterInfoRow[];
  /** Betreffzeile (no "Betreff:" prefix per DIN 5008). */
  subject: string;
  /** Fußzeilen-Text without the page number; the frame appends "Seite x/y". */
  footerText: string;
  /**
   * Vertical position (mm from the paper edge) of the first body line on page 1.
   * Defaults to the DIN 5008 reference line at 98,46 mm. Content-heavy letters
   * (e.g. the Kulanz cover page with table plus two boxes) may pass a smaller
   * value to start a touch higher and stay a single page. The address window
   * stays put either way, so a lower value never breaks the envelope fold.
   */
  bodyStartMm?: number;
  children: ReactNode;
};

/** DIN 5008 reference line for the first body line, in mm from the paper edge. */
const DIN_REFERENCE_MM = 98.46;

/**
 * One DIN 5008 letter page. Callers wrap one or more of these in a `<Document>`.
 * The address field, info block and letterhead render on the first page only;
 * the fold marks and footer repeat on every page.
 */
/**
 * Every string that reaches a built-in PDF font passes through here. The
 * address block carries member-supplied names, which is exactly where a
 * silently wrong glyph does the most damage.
 */
export function LetterPage({
  logoDataUri,
  orgName,
  returnLine,
  recipientLines,
  recipientNote,
  infoRows,
  subject,
  footerText,
  bodyStartMm = DIN_REFERENCE_MM,
  children,
}: LetterPageProps) {
  const leadHeight = Math.max(0, mm(bodyStartMm) - mm(25));
  return (
    <Page size="A4" style={styles.page} wrap>
      <FoldAndHoleMarks />

      <View style={styles.header}>
        {logoDataUri ? <Image src={logoDataUri} style={styles.logo} /> : <View />}
        <Text style={styles.orgName}>{winAnsiSafe(orgName)}</Text>
      </View>

      <View style={styles.addressField}>
        <Text style={styles.returnLine}>{winAnsiSafe(returnLine)}</Text>
        {recipientLines.map((line, i) => (
          <Text key={String(i)} style={styles.recipientLine}>
            {winAnsiSafe(line)}
          </Text>
        ))}
        {recipientNote ? (
          <Text style={styles.recipientNote}>{winAnsiSafe(recipientNote)}</Text>
        ) : null}
      </View>

      <View style={styles.infoBlock}>
        {infoRows.map((row, i) => (
          <View key={String(i)} style={styles.infoRow}>
            <Text style={styles.infoLabel}>{winAnsiSafe(row.label)}</Text>
            <Text style={styles.infoValue}>{winAnsiSafe(row.value)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.body}>
        <View style={{ height: leadHeight }} />
        <Text style={styles.subject}>{winAnsiSafe(subject)}</Text>
        {children}
      </View>

      <Text
        style={styles.footer}
        render={({ subPageNumber, subPageTotalPages }) =>
          `${winAnsiSafe(footerText)} · Seite ${subPageNumber}/${subPageTotalPages}`
        }
        fixed
      />
    </Page>
  );
}
