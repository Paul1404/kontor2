import { eq } from "drizzle-orm";
import type { DBOrTx } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import type { AntragsRolle } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { categoryFromAge } from "~/server/domain/application/antragstyp";
import { antragsRolleFor } from "~/server/domain/application/fees";
import { executeContractSwitch, planContractSwitch } from "~/server/domain/contract-switch";

/** A late-year admission also needs the already agreed successor tariff. */
export async function scheduleApplicationContract(
  db: DBOrTx,
  contractId: string,
  role: AntragsRolle,
  actor: { id: string; email: string; requestId?: string | null },
) {
  const [org] = await db
    .select({ schedule: organizationSettingsTable.applicationFeeSchedule })
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  const schedule = org?.schedule;
  if (!schedule) return;
  const [old] = await db
    .select({
      art: contractsTable.art,
      start: contractsTable.vertragBegin,
      birth: membersTable.geburtsdatum,
    })
    .from(contractsTable)
    .innerJoin(membersTable, eq(membersTable.id, contractsTable.memberId))
    .where(eq(contractsTable.id, contractId));
  if (!old) return;
  const targetRole = old.birth
    ? antragsRolleFor(
        categoryFromAge(
          old.birth,
          schedule.altersgrenzen,
          role === "familie",
          new Date(`${schedule.effectiveFrom}T12:00:00Z`),
        ),
        role.endsWith("_eltern_mitglied"),
      )
    : role;
  const art = schedule.feeTypes?.[targetRole];
  if (
    art == null ||
    old.art === art ||
    (old.start && old.start >= new Date(`${schedule.effectiveFrom}T00:00:00Z`))
  )
    return;
  const input = { contractId, art, effectiveDate: schedule.effectiveFrom };
  const plan = await planContractSwitch(db, input);
  await executeContractSwitch(db, { ...input, revision: plan.revision }, actor);
}
