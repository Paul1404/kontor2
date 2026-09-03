import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { appendAudit, type Changes } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { type Member, membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { deriveStatus } from "~/server/domain/member";
import { assertCancellationAllowed } from "~/server/lib/cancellation-frist";
import { type AustrittPlan, planAustrittCascade } from "~/server/lib/member-lifecycle";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

export type ExecuteAustrittInput = {
  memberId: string;
  /** Leave date as `YYYY-MM-DD`. */
  austrittDatum: string;
  /** "verstorben" stamps verstorbenAm instead of austritt and skips the Frist. */
  reason: "austritt" | "verstorben";
  revokeSepa: boolean;
  abteilungIds?: string[] | null;
  /**
   * Day the Kündigungsfrist is measured from. Pass the day the written notice
   * arrived when one exists, so a letter recorded late keeps its earlier
   * Austrittstermin. Defaults to now for an ad-hoc entry.
   */
  referenceDate?: Date;
  /** Skip the Frist check. Only for a documented, deliberate deviation. */
  skipFristCheck?: boolean;
  actor: { id: string; email: string };
  requestId?: string | null;
  /** Merged into the audit entry, e.g. the evidence of a recorded Kündigung. */
  extraAuditChanges?: Changes;
  snapshotNotes?: string;
};

export type ExecuteAustrittResult = {
  member: Member;
  plan: AustrittPlan;
  auditId: string | null;
  counts: { abteilungen: number; vertraege: number; sepaMandate: number };
};

/**
 * Stamp a leave date on a member and cascade it to every still-open department
 * membership, open contract and (optionally) active SEPA mandate, so the
 * member's records end up internally consistent instead of half-closed.
 *
 * Must run inside a transaction. Pure decision logic lives in
 * `~/server/lib/member-lifecycle`; this function is the write half, shared by
 * the quick `members.austritt` action and the evidence-backed
 * `cancellations.record` workflow. Reversible via `members.reactivate`.
 */
export async function executeAustritt(
  tx: DBOrTx,
  input: ExecuteAustrittInput,
): Promise<ExecuteAustrittResult> {
  const austrittTs = new Date(`${input.austrittDatum}T00:00:00Z`);
  const now = new Date();

  const [member] = await tx
    .select()
    .from(membersTable)
    .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
    .limit(1);
  if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

  // The Kündigungsfrist applies to a voluntary Austritt, not to recording a
  // death (which is typically backdated).
  if (input.reason === "austritt" && !input.skipFristCheck) {
    const [settings] = await tx.select().from(organizationSettingsTable).limit(1);
    assertCancellationAllowed(settings, austrittTs, input.referenceDate ?? now);
  }

  const [abteilungen, contracts, sepa] = await Promise.all([
    tx
      .select({
        abteilungId: memberAbteilungenTable.abteilungId,
        eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
        austrittsdatum: memberAbteilungenTable.austrittsdatum,
      })
      .from(memberAbteilungenTable)
      .where(eq(memberAbteilungenTable.memberId, input.memberId)),
    tx
      .select({ id: contractsTable.id, gekuendZum: contractsTable.gekuendZum })
      .from(contractsTable)
      .where(eq(contractsTable.memberId, input.memberId)),
    tx
      .select({
        id: sepaMandatesTable.id,
        isDeleted: sepaMandatesTable.isDeleted,
        widerrufenAm: sepaMandatesTable.widerrufenAm,
      })
      .from(sepaMandatesTable)
      .where(eq(sepaMandatesTable.memberId, input.memberId)),
  ]);

  const plan = planAustrittCascade({
    austrittDatum: input.austrittDatum,
    abteilungen,
    contracts,
    sepa,
    revokeSepa: input.revokeSepa,
    abteilungIds: input.abteilungIds,
  });

  // Member row: stamp the leave/death date.
  const memberSet: Record<string, unknown> = { updatedAt: now };
  if (input.reason === "verstorben") {
    memberSet.verstorbenAm = austrittTs;
  } else {
    memberSet.austritt = austrittTs;
  }
  // Normalized status as of today: a leave date that has arrived flips the
  // member to ausgetreten/verstorben, but a *future* leave date leaves them
  // live (notice given, still a member until then). The nightly reconcile
  // flips them once the date passes.
  memberSet.status = deriveStatus({
    austritt: (memberSet.austritt as Date | null) ?? member.austritt,
    verstorbenAm: (memberSet.verstorbenAm as Date | null) ?? member.verstorbenAm,
  });
  await tx
    .update(membersTable)
    .set(memberSet as never)
    .where(eq(membersTable.id, input.memberId));

  // Department memberships: close the open ones on the leave date.
  for (const a of plan.abteilungClose) {
    await tx
      .update(memberAbteilungenTable)
      .set({ austrittsdatum: input.austrittDatum })
      .where(
        and(
          eq(memberAbteilungenTable.memberId, input.memberId),
          eq(memberAbteilungenTable.abteilungId, a.abteilungId),
          eq(memberAbteilungenTable.eintrittsdatum, a.eintrittsdatum),
        ),
      );
  }

  // Contracts: terminate to the leave date; record the notice date only when
  // it is not already set.
  if (plan.contractClose.length > 0) {
    await tx
      .update(contractsTable)
      .set({
        gekuendZum: austrittTs,
        vertragEnde: austrittTs,
        // Raw SQL bypasses the `date` column mapper, so pass the ISO string
        // (input.austrittDatum), not the Date -- a Date crashes the driver.
        gekuendAm: sql`coalesce(${contractsTable.gekuendAm}, ${input.austrittDatum})`,
        updatedAt: now,
      } as never)
      .where(inArray(contractsTable.id, plan.contractClose));
  }

  // SEPA mandates: revoke as of the leave date so no further debits run.
  if (plan.sepaRevoke.length > 0) {
    await tx
      .update(sepaMandatesTable)
      .set({ widerrufenAm: austrittTs, gultigBis: austrittTs, updatedAt: now } as never)
      .where(inArray(sepaMandatesTable.id, plan.sepaRevoke));
  }

  const counts = {
    abteilungen: plan.abteilungClose.length,
    vertraege: plan.contractClose.length,
    sepaMandate: plan.sepaRevoke.length,
  };

  const auditId = await appendAudit(tx, {
    entityType: "member",
    entityId: input.memberId,
    action: "update",
    source: "ui",
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    changes: {
      [input.reason === "verstorben" ? "verstorbenAm" : "austritt"]: {
        before: input.reason === "verstorben" ? member.verstorbenAm : member.austritt,
        after: input.austrittDatum,
      },
      austrittKaskade: { before: null, after: counts },
      ...input.extraAuditChanges,
    },
    requestId: input.requestId ?? null,
  });
  await takeMemberSnapshot(tx, input.memberId, {
    trigger: "mutation",
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    auditId,
    notes: input.snapshotNotes,
  });

  return { member, plan, auditId, counts };
}
