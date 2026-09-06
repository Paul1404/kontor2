import { ORPCError } from "@orpc/server";
import { inArray, sql } from "drizzle-orm";
import { appendAudit, diff } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import type { MemberStatus } from "~/server/domain/member";
import { generateMemberNumber } from "~/server/domain/member-number";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

export type OnboardContractValues = {
  art: number;
  artName: string | null;
  vertragNr: string | null;
  /** Already validated/normalized Betrag string, or null. */
  betrag: string | null;
  vertragBegin: Date | null;
  sollstellung: string | null;
  /** Divergent account holder (abweichender Kontoinhaber), or null when the
   *  member's own name is the debtor. Printed as the SEPA debtor name. */
  abwKontoInh?: string | null;
  /**
   * Whether this contract is collected by SEPA direct debit. Drives the fee
   * run: false routes the contract to the invoice (Rechnungszahler) branch and
   * skips the direct-debit line. Set from whether a bank account exists for the
   * payer, NOT from where the mandate sits (a minor's contract is direct debit
   * even though the mandate is on the guardian). Defaults to false.
   */
  isDirectDebit?: boolean;
};

export type OnboardSepaValues = {
  mandatsNr: string | null;
  unterschriftDatum: Date | null;
  gueltigAb: Date | null;
};

export type OnboardMemberOpts = {
  /** DB-row partial built by the caller (e.g. `buildMemberPatch`). */
  patch: Record<string, unknown>;
  /** A contact/payer (K-number) instead of a real member (M-number). */
  isKontakt: boolean;
  /** Pre-resolved normalized status. */
  status: MemberStatus;
  abteilungen: { abteilungId: string; eintrittsdatum?: string | null }[];
  /** Fallback Eintrittsdatum (yyyy-mm-dd) for department rows without one. */
  fallbackEintritt: string;
  contract: OnboardContractValues | null;
  sepa: OnboardSepaValues | null;
  actorId: string;
  actorEmail: string;
  requestId: string | null;
  /** Audit source; defaults to "ui". */
  source?: "ui" | "import" | "system" | "dsgvo";
};

export type OnboardMemberResult = {
  id: string;
  memberNo: string | null;
  kontaktNo: string | null;
  ref: string;
  adrNr: number;
};

/**
 * Create a member (or contact) plus its optional first department(s), contract
 * and SEPA mandate inside an existing transaction, then write the audit entry
 * and the initial snapshot. This is the single source of truth shared by the
 * manual onboarding wizard (`members.onboard`) and the application-approval
 * flow (`applications.approve`), so member-number minting, audit and snapshot
 * behave identically on both paths.
 *
 * Must run inside a transaction and be wrapped in `withUniqueRetry` by the
 * caller: the app-owned number is minted optimistically and relies on the
 * partial unique index + retry to absorb the rare collision.
 */
export async function onboardMember(
  tx: DBOrTx,
  opts: OnboardMemberOpts,
): Promise<OnboardMemberResult> {
  const [maxRow] = await tx
    .select({ maxAdrNr: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
    .from(membersTable);
  const nextAdrNr = (maxRow?.maxAdrNr ?? 0) + 1;
  const memberNo = opts.isKontakt ? null : generateMemberNumber("member");
  const kontaktNo = opts.isKontakt ? generateMemberNumber("kontakt") : null;
  const ref = (memberNo ?? kontaktNo) as string;

  const now = new Date();
  const cleanCols = {
    memberNo,
    kontaktNo,
    status: opts.status,
    dunningBlocked: false,
    directDebitBlocked: false,
  };
  const [inserted] = await tx
    .insert(membersTable)
    .values({
      ...opts.patch,
      adrNr: nextAdrNr,
      ...cleanCols,
      createdAt: now,
      updatedAt: now,
    } as never)
    .returning({
      id: membersTable.id,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
    });
  if (!inserted) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
  }

  // Departments. Validate the ids up front so a bad one fails clean
  // instead of as an opaque FK error.
  const abteilungIds = [...new Set(opts.abteilungen.map((a) => a.abteilungId))];
  if (abteilungIds.length > 0) {
    const found = await tx
      .select({ id: abteilungenTable.id })
      .from(abteilungenTable)
      .where(inArray(abteilungenTable.id, abteilungIds));
    if (found.length !== abteilungIds.length) {
      throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });
    }
    for (const a of opts.abteilungen) {
      await tx
        .insert(memberAbteilungenTable)
        .values({
          memberId: inserted.id,
          abteilungId: a.abteilungId,
          eintrittsdatum: a.eintrittsdatum ?? opts.fallbackEintritt,
        })
        .onConflictDoNothing();
    }
  }

  // Optional first contract.
  if (opts.contract) {
    await tx.insert(contractsTable).values({
      memberId: inserted.id,
      adrNr: nextAdrNr,
      mitglNr: ref,
      vertragNr:
        opts.contract.vertragNr && opts.contract.vertragNr.trim().length > 0
          ? opts.contract.vertragNr.trim()
          : "1",
      art: opts.contract.art,
      artName: opts.contract.artName ?? null,
      betrag: opts.contract.betrag,
      sollstellung: opts.contract.sollstellung ?? null,
      vertragBegin: opts.contract.vertragBegin,
      abwKontoInh: opts.contract.abwKontoInh ?? null,
      isDirectDebit: opts.contract.isDirectDebit ?? false,
    } as never);
  }

  // Optional first SEPA mandate.
  if (opts.sepa) {
    await tx.insert(sepaMandatesTable).values({
      memberId: inserted.id,
      adrNr: nextAdrNr,
      mandatsNr:
        opts.sepa.mandatsNr && opts.sepa.mandatsNr.trim().length > 0
          ? opts.sepa.mandatsNr.trim()
          : "M1",
      angelegtAm: now,
      unterschriftDatum: opts.sepa.unterschriftDatum,
      gueltigAb: opts.sepa.gueltigAb,
    } as never);
  }

  const auditId = await appendAudit(tx, {
    entityType: "member",
    entityId: inserted.id,
    action: "create",
    source: opts.source ?? "ui",
    actorId: opts.actorId,
    actorEmail: opts.actorEmail,
    changes: diff(null, {
      ...opts.patch,
      adrNr: nextAdrNr,
      ...cleanCols,
      abteilungen: opts.abteilungen.length,
      vertrag: opts.contract ? 1 : 0,
      sepaMandat: opts.sepa ? 1 : 0,
    }),
    requestId: opts.requestId,
  });
  await takeMemberSnapshot(tx, inserted.id, {
    trigger: "mutation",
    actorId: opts.actorId,
    actorEmail: opts.actorEmail,
    auditId,
  });

  return {
    id: inserted.id,
    memberNo: inserted.memberNo ?? memberNo,
    kontaktNo: inserted.kontaktNo ?? kontaktNo,
    ref,
    adrNr: nextAdrNr,
  };
}
