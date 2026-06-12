import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import * as v from "valibot";
import { allocateDocRef } from "~/server/db/doc-ref";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { vorstandProc } from "~/server/orpc/base";
import { resolveClubLogo } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { RechnungDocument } from "~/server/pdf/templates/rechnung";

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const invoicesRouter = {
  /**
   * Rechnungs-PDF über die offenen Beiträge (Sollstellungen im Status "open")
   * eines Mitglieds: Nummernkreis RG-JJJJ-NNNN, Vereins-Bankverbindung zum
   * Überweisen, 14 Tage Zahlungsziel. Reine Erzeugung (kein Status-Wechsel) --
   * die Sollstellung gilt erst nach Zahlungseingang als beglichen.
   */
  renderForMember: vorstandProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org) {
        throw new ORPCError("PRECONDITION_FAILED", { message: "Vereinsdaten fehlen." });
      }

      const [member] = await context.db
        .select({
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          adrNr: membersTable.adrNr,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          kurzname: membersTable.kurzname,
          firma1: membersTable.firma1,
          anrede: membersTable.anrede,
          strasse: membersTable.strasse,
          hausnummer: membersTable.hausnummer,
          plz: membersTable.plz,
          ort: membersTable.ort,
        })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }

      const rows = await context.db
        .select({
          billingYear: sollStellungenTable.billingYear,
          falligkeitsdatum: sollStellungenTable.falligkeitsdatum,
          openAmount: sollStellungenTable.openAmount,
          artName: contractsTable.artName,
          vertragNr: contractsTable.vertragNr,
        })
        .from(sollStellungenTable)
        .innerJoin(contractsTable, eq(sollStellungenTable.contractId, contractsTable.id))
        .where(
          and(
            eq(sollStellungenTable.memberId, input.memberId),
            eq(sollStellungenTable.status, "open"),
          ),
        )
        .orderBy(asc(sollStellungenTable.billingYear));
      if (rows.length === 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Keine offenen Rechnungsposten für dieses Mitglied.",
        });
      }

      const totalCents = rows.reduce(
        (sum, r) => sum + Math.round(Number.parseFloat(r.openAmount) * 100),
        0,
      );
      const totalDue = (totalCents / 100).toFixed(2);

      const today = new Date();
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 14);
      const docRef = await allocateDocRef(context.db, "RG", today.getUTCFullYear());

      const { base64 } = await renderPdfBase64(
        RechnungDocument({
          docRef,
          pkg: {
            runDate: toIsoDay(today),
            dueDate: toIsoDay(dueDate),
            organization: {
              vereinsname: org.vereinsname,
              anschriftStrasse: org.anschriftStrasse,
              anschriftPlz: org.anschriftPlz,
              anschriftOrt: org.anschriftOrt,
              vereinsIban: org.vereinsIban,
              vereinsBic: org.vereinsBic,
              vereinsBankname: org.vereinsBankname,
              glaeubigerId: org.glaeubigerId,
              logoDataUri: resolveClubLogo(org.logo),
            },
            member,
            postings: rows.map((r) => ({
              billingYear: r.billingYear,
              falligkeitsdatum:
                typeof r.falligkeitsdatum === "string"
                  ? r.falligkeitsdatum
                  : toIsoDay(r.falligkeitsdatum),
              description: r.artName ?? `Mitgliedsbeitrag (Vertrag ${r.vertragNr})`,
              openAmount: r.openAmount,
            })),
            totalDue,
          },
        }),
      );

      return { filename: `Rechnung-${docRef}.pdf`, base64, docRef };
    }),
};
