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
  datum: string;
  subject: string;
  paragraphs: string[];
};

function SerienbriefPage({ club, letter }: { club: SerienbriefClub; letter: SerienbriefLetter }) {
  return (
    <LetterPage
      logoDataUri={club.logoDataUri}
      orgName={club.vereinsname}
      returnLine={club.senderLine}
      recipientLines={letter.recipientLines}
      infoRows={[
        { label: letter.referenceLabel, value: letter.reference },
        { label: "Datum", value: letter.datum },
      ]}
      subject={letter.subject}
      footerText={club.vereinsname}
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
  letters,
}: {
  club: SerienbriefClub;
  letters: SerienbriefLetter[];
}) {
  return (
    <Document title={`Serienbrief · ${letters.length} Schreiben`} author={club.vereinsname}>
      {letters.map((letter, i) => (
        <SerienbriefPage key={String(i)} club={club} letter={letter} />
      ))}
    </Document>
  );
}
