#!/usr/bin/env bun
/**
 * Seed test membership applications (Online-Aufnahmeanträge) for local work on
 * the /app/antraege review surface. Every row is flagged `is_test = true`, so
 * the admin list hides them behind the "Testdaten anzeigen" toggle and the
 * stats/CSV exclude them by default. Rows are written straight to the DB; no
 * PDF, S3 upload, or mail happens (those paths are exercised by the real public
 * submit flow, not by seeding).
 *
 * Usage:
 *   bun run db:seed:antraege          # 12 applications across all three types
 *   bun run db:seed:antraege 30       # a custom count
 *
 * Clean up afterwards from the app (Papierkorb / DB) or:
 *   delete from membership_applications where is_test;
 */
import { eq } from "drizzle-orm";
import { lastFour } from "~/server/crypto/encrypt";
import { closeDb, db } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
import { abteilungenTable } from "~/server/db/schema/abteilungen";
import {
  type AntragKind,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import {
  type Antragstyp,
  detectAntragstyp,
  mitgliedschaftTypFor,
} from "~/server/domain/application/antragstyp";
import { calculateFee } from "~/server/domain/application/fees";

const VORNAMEN_M = [
  "Lukas",
  "Jonas",
  "Felix",
  "Paul",
  "Tim",
  "Max",
  "Leon",
  "Noah",
  "Ben",
  "Elias",
];
const VORNAMEN_W = [
  "Mia",
  "Emma",
  "Hannah",
  "Lena",
  "Sophia",
  "Anna",
  "Lea",
  "Marie",
  "Laura",
  "Nina",
];
const NACHNAMEN = [
  "Müller",
  "Schmidt",
  "Schneider",
  "Fischer",
  "Weber",
  "Meyer",
  "Wagner",
  "Becker",
  "Hoffmann",
  "Schäfer",
  "Koch",
  "Bauer",
  "Richter",
  "Klein",
  "Wolf",
  "Schröder",
];
const STRASSEN = [
  "Hauptstraße",
  "Bahnhofstraße",
  "Kirchweg",
  "Am Sportplatz",
  "Lindenweg",
  "Schulstraße",
];
const ORTE: Array<[string, string]> = [
  ["97488", "Untereuerheim"],
  ["97469", "Gochsheim"],
  ["97318", "Kitzingen"],
  ["97421", "Schweinfurt"],
];

const TEST_IBAN = "DE89370400440532013000";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** A birth date that lands the applicant in roughly the requested age range. */
function dobForAge(minAge: number, maxAge: number): Date {
  const age = randomInt(minAge, maxAge);
  const now = new Date();
  return new Date(now.getUTCFullYear() - age, randomInt(0, 11), randomInt(1, 28));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const count = Number(process.argv[2] ?? "12");
  if (!Number.isFinite(count) || count < 1) {
    console.error("[seed-antraege] count must be a positive number");
    process.exit(1);
  }

  const handle = db();
  try {
    const [org] = await handle.select().from(organizationSettingsTable).limit(1);
    if (!org?.beitragsstaffel) {
      throw new Error(
        "Keine Beitragsstaffel konfiguriert. Seed-Daten übernehmen keine Preise eines anderen Vereins.",
      );
    }
    const staffel = org.beitragsstaffel;
    const prefix = org?.mandatsreferenzPrefix ?? "";

    const abteilungen = await handle
      .select({ id: abteilungenTable.id })
      .from(abteilungenTable)
      .where(eq(abteilungenTable.inaktiv, false));
    const abtIds = abteilungen.map((a) => a.id);
    const someAbteilungen = (): string[] => {
      if (abtIds.length === 0) return [];
      const n = randomInt(1, Math.min(2, abtIds.length));
      return [...abtIds].sort(() => Math.random() - 0.5).slice(0, n);
    };

    const typen: Antragstyp[] = ["einzel", "kind", "familie"];
    const statuses = ["neu", "dokument_hochgeladen", "in_bearbeitung"] as const;
    const year = new Date().getUTCFullYear();
    const created: Record<Antragstyp, number> = { einzel: 0, kind: 0, familie: 0 };

    for (let i = 0; i < count; i++) {
      const typ = typen[i % typen.length]!;
      const male = Math.random() < 0.5;
      const vorname = male ? pick(VORNAMEN_M) : pick(VORNAMEN_W);
      const nachname = pick(NACHNAMEN);
      const [plz, ort] = pick(ORTE);
      const strasse = pick(STRASSEN);
      const hausnummer = String(randomInt(1, 80));

      // Pick a birth date per type, then let the domain logic confirm the type.
      const dob =
        typ === "kind"
          ? dobForAge(6, 13)
          : typ === "familie"
            ? dobForAge(30, 50)
            : dobForAge(19, 70);
      const hasChildren = typ === "familie";
      const hasPartner = typ === "familie";
      const antragstyp = detectAntragstyp({ geburtsdatum: dob, hasChildren, hasPartner });
      const kategorie = mitgliedschaftTypFor(antragstyp, dob);
      const elternteilMitglied = antragstyp === "kind" && Math.random() < 0.4;
      const fee = calculateFee({ kategorie, elternteilMitglied, staffel });

      const kinder: AntragKind[] =
        antragstyp === "familie"
          ? Array.from({ length: randomInt(1, 3) }, () => ({
              vorname: Math.random() < 0.5 ? pick(VORNAMEN_M) : pick(VORNAMEN_W),
              nachname,
              geburtsdatum: iso(dobForAge(3, 16)),
              abteilungen: someAbteilungen(),
            }))
          : [];

      const antragsnummer = await allocateDocRef(handle, "ANT", year);
      const suffix = /-(\d+)$/.exec(antragsnummer)?.[1] ?? antragsnummer;

      await handle.insert(membershipApplicationsTable).values({
        antragsnummer,
        antragstyp,
        status: pick([...statuses]),
        source: "online",
        mitgliedschaftTyp: kategorie,
        geschlecht: male ? "m" : "w",
        vorname,
        nachname,
        geburtsdatum: dob,
        strasse,
        hausnummer,
        plz,
        ort,
        telefon: `09382 ${randomInt(1000, 9999)}`,
        email: `${vorname}.${nachname}@example.test`
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue"),
        erziehungsberechtigterVorname:
          antragstyp === "kind" ? pick([...VORNAMEN_M, ...VORNAMEN_W]) : null,
        erziehungsberechtigterNachname: antragstyp === "kind" ? nachname : null,
        partnerVorname:
          antragstyp === "familie" ? (male ? pick(VORNAMEN_W) : pick(VORNAMEN_M)) : null,
        partnerNachname: antragstyp === "familie" ? nachname : null,
        partnerGeburtsdatum: antragstyp === "familie" ? dobForAge(30, 50) : null,
        partnerAbteilungen: antragstyp === "familie" ? someAbteilungen() : null,
        kinder,
        abteilungen: someAbteilungen(),
        elternteilMitglied,
        jahresbeitrag: fee.betrag,
        kontoinhaber: `${vorname} ${nachname}`,
        iban: TEST_IBAN,
        ibanLast4: lastFour(TEST_IBAN),
        bic: "COBADEFFXXX",
        kreditinstitut: "Testbank",
        mandatsreferenz: `${prefix}${year}-${suffix}`,
        consentAt: new Date(),
        datenschutzAccepted: true,
        satzungAccepted: true,
        consentIp: "127.0.0.1",
        isTest: true,
      });
      created[antragstyp] += 1;
    }

    console.log(
      `[seed-antraege] ${count} Testanträge angelegt · einzel=${created.einzel} kind=${created.kind} familie=${created.familie}`,
    );
    if (abtIds.length === 0) {
      console.log(
        "[seed-antraege] Hinweis: keine aktiven Abteilungen gefunden, Anträge ohne Abteilung.",
      );
    }
  } catch (err) {
    console.error("[seed-antraege] failed:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
