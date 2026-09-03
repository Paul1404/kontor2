import { Document, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { MailBlock } from "~/server/mail/layout";
import { LetterPage } from "~/server/pdf/letter-layout";

/**
 * A member notification on paper, built from the same block list that drives the
 * email. Post is the second regular channel, not a fallback, so the two must say
 * the same thing; deriving both from one content definition is what keeps them
 * from drifting the way separate letter and mail texts always do.
 *
 * Workflows with their own letter (the Austrittsbestätigung) keep it. This is
 * for the ones that would otherwise have no paper path at all.
 */

const styles = StyleSheet.create({
  para: { marginBottom: 10 },
  note: { marginBottom: 10, fontSize: 9, color: "#3f4857" },
  bullet: { marginBottom: 4, paddingLeft: 10 },
  calloutBox: {
    marginTop: 6,
    marginBottom: 12,
    padding: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#14223d",
    backgroundColor: "#f6f3ec",
  },
  calloutLabel: { fontSize: 8, color: "#5b6472", textTransform: "uppercase" },
  calloutValue: { fontSize: 12, marginTop: 2 },
  closing: { marginTop: 16 },
  enclosures: { marginTop: 18, fontSize: 9 },
});

export type MitteilungClub = {
  vereinsname: string;
  senderLine: string;
  logoDataUri: string | null;
};

export type MitteilungModel = {
  recipientLines: string[];
  reference: string;
  referenceLabel: string;
  datum: string;
  subject: string;
  greeting: string | null;
  blocks: MailBlock[];
  closing: string | null;
  /**
   * Anlagenvermerk per DIN 5008. An enclosure travels in the same envelope as
   * a separate document; naming it on the letter is what ties the two together
   * once they are out of the printer.
   */
  enclosures?: string[];
};

function Block({ block }: { block: MailBlock }) {
  if (block.kind === "paragraph") return <Text style={styles.para}>{block.text}</Text>;
  if (block.kind === "note") return <Text style={styles.note}>{block.text}</Text>;
  if (block.kind === "callout") {
    return (
      <View style={styles.calloutBox}>
        <Text style={styles.calloutLabel}>{block.label}</Text>
        <Text style={styles.calloutValue}>{block.value}</Text>
      </View>
    );
  }
  if (block.kind === "bullets") {
    return (
      <View style={styles.para}>
        {block.items.map((item) => (
          <Text key={item} style={styles.bullet}>
            {`•  ${item}`}
          </Text>
        ))}
      </View>
    );
  }
  // A button has nothing to click on paper, so the destination is spelled out.
  return <Text style={styles.para}>{`${block.label}: ${block.url}`}</Text>;
}

export function MitteilungDocument({
  club,
  docRef,
  model,
}: {
  club: MitteilungClub;
  docRef: string;
  model: MitteilungModel;
}) {
  return (
    <Document
      title={model.subject}
      author={club.vereinsname}
      subject={model.subject}
      creator="Kontor²"
    >
      <LetterPage
        logoDataUri={club.logoDataUri}
        orgName={club.vereinsname}
        returnLine={club.senderLine}
        recipientLines={model.recipientLines}
        infoRows={[
          { label: "Dokument", value: docRef },
          { label: model.referenceLabel, value: model.reference },
          { label: "Datum", value: model.datum },
        ]}
        subject={model.subject}
        footerText={`${club.vereinsname} · ${docRef}`}
      >
        {model.greeting ? <Text style={styles.para}>{model.greeting}</Text> : null}
        {model.blocks.map((block, index) => (
          <Block key={String(index)} block={block} />
        ))}
        {model.closing ? (
          <View style={styles.closing}>
            <Text>{model.closing}</Text>
            <Text>{club.vereinsname}</Text>
          </View>
        ) : null}
        {model.enclosures && model.enclosures.length > 0 ? (
          <View style={styles.enclosures}>
            <Text>{model.enclosures.length === 1 ? "Anlage" : "Anlagen"}</Text>
            {model.enclosures.map((entry) => (
              <Text key={entry}>{entry}</Text>
            ))}
          </View>
        ) : null}
      </LetterPage>
    </Document>
  );
}
