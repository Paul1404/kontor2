import { and, eq, ilike, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { memberNotDeleted } from "~/server/db/member-filters";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { authedProc } from "~/server/orpc/base";

/**
 * Global lookup beyond members: find which member a Vertragsnummer or
 * SEPA-Mandatsreferenz belongs to. Powers the extra sections in the command
 * palette. Members themselves stay on the existing `members.quickSearch`.
 */

const Input = v.object({
  q: v.pipe(v.string(), v.trim()),
  limit: v.optional(v.number(), 6),
});

export const searchRouter = {
  entities: authedProc.input(Input).handler(async ({ context, input }) => {
    const q = input.q;
    if (q.length < 2) return { contracts: [], mandates: [] };
    const like = `%${q}%`;
    const lim = Math.min(input.limit, 10);

    const memberCols = {
      memberId: membersTable.id,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      adrNr: membersTable.adrNr,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      kurzname: membersTable.kurzname,
      firma1: membersTable.firma1,
    };

    const [contracts, mandates] = await Promise.all([
      context.db
        .select({
          ...memberCols,
          id: contractsTable.id,
          vertragNr: contractsTable.vertragNr,
          artName: contractsTable.artName,
          betrag: contractsTable.betrag,
        })
        .from(contractsTable)
        .innerJoin(membersTable, eq(membersTable.id, contractsTable.memberId))
        .where(
          and(
            memberNotDeleted(),
            or(
              ilike(contractsTable.vertragNr, like),
              ilike(contractsTable.artName, like),
              ilike(contractsTable.mitglNr, like),
            ),
          ),
        )
        .orderBy(sql`${contractsTable.vertragNr} asc`)
        .limit(lim),
      context.db
        .select({
          ...memberCols,
          id: sepaMandatesTable.id,
          mandatsNr: sepaMandatesTable.mandatsNr,
          mandKey: sepaMandatesTable.mandKey,
          status: sepaMandatesTable.status,
        })
        .from(sepaMandatesTable)
        .innerJoin(membersTable, eq(membersTable.id, sepaMandatesTable.memberId))
        .where(
          and(
            memberNotDeleted(),
            or(ilike(sepaMandatesTable.mandatsNr, like), ilike(sepaMandatesTable.mandKey, like)),
          ),
        )
        .orderBy(sql`${sepaMandatesTable.mandatsNr} asc`)
        .limit(lim),
    ]);

    return {
      contracts: contracts.map((c) => ({
        id: c.id,
        reference: memberRef(c),
        memberName: memberDisplayName(c),
        vertragNr: c.vertragNr,
        artName: c.artName,
        betrag: c.betrag,
      })),
      mandates: mandates.map((m) => ({
        id: m.id,
        reference: memberRef(m),
        memberName: memberDisplayName(m),
        mandatsNr: m.mandatsNr,
        status: m.status,
      })),
    };
  }),
};
