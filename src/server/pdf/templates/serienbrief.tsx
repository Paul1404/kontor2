import { Document, StyleSheet, Text } from "@react-pdf/renderer";
import { LetterPage } from "~/server/pdf/letter-layout";

/**
 * Serienbrief: one DIN 5008 letter per postal recipient in a single PDF, so the
 * Vorstand can print and mail the same Rundschreiben to members without an email
 * address. The body is the merged text (paragraphs split on blank lines).
 */

const styles = StyleSheet.create({
  para: { marginBottom: 10 },
});

export type SerienbriefClub = {
  vereinsname: string;
  senderLine: string;
  logoDataUri: string | null;
};

export type SerienbriefLetter = {
  recipientLines: string[];
  reference: string;
  referenceLabel: string;
  /** Legacy Linear Mitgliedsnummer as a separate "(alt)" line, or null. */
  legacyMitgliedsnummer: string | null;
  datum: string;
  subject: string;
  paragraphs: string[];
};

function SerienbriefPage({
  club,
  docRef,
  letter,
}: {
  club: SerienbriefClub;
  docRef: string;
  letter: SerienbriefLetter;
}) {
  return (
    <LetterPage
      logoDataUri={club.logoDataUri}
      orgName={club.vereinsname}
      returnLine={club.senderLine}
      recipientLines={letter.recipientLines}
      infoRows={[
        { label: "Dokument", value: docRef },
        { label: letter.referenceLabel, value: letter.reference },
        ...(letter.legacyMitgliedsnummer
          ? [{ label: "Mitgliedsnummer (alt)", value: letter.legacyMitgliedsnummer }]
          : []),
        { label: "Datum", value: letter.datum },
      ]}
      subject={letter.subject}
      footerText={`${club.vereinsname} · ${docRef}`}
    >
      {letter.paragraphs.map((p, i) => (
        <Text key={String(i)} style={styles.para}>
          {p}
        </Text>
      ))}
    </LetterPage>
  );
}

export function SerienbriefDocument({
  club,
  docRef,
  letters,
}: {
  club: SerienbriefClub;
  docRef: string;
  letters: SerienbriefLetter[];
}) {
  return (
    <Document
      title={`Serienbrief ${docRef} · ${letters.length} Schreiben`}
      author={club.vereinsname}
    >
      {letters.map((letter, i) => (
        <SerienbriefPage key={String(i)} club={club} docRef={docRef} letter={letter} />
      ))}
    </Document>
  );
}
