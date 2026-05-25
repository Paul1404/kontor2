import { abteilungenRouter } from "~/server/orpc/procedures/abteilungen";
import { attachmentsRouter } from "~/server/orpc/procedures/attachments";
import { auditRouter } from "~/server/orpc/procedures/audit";
import { authRouter } from "~/server/orpc/procedures/auth";
import { banksRouter } from "~/server/orpc/procedures/banks";
import { contractsRouter } from "~/server/orpc/procedures/contracts";
import { dangerZoneRouter } from "~/server/orpc/procedures/danger-zone";
import { dashboardRouter } from "~/server/orpc/procedures/dashboard";
import { dsgvoRouter } from "~/server/orpc/procedures/dsgvo";
import { dunningRouter } from "~/server/orpc/procedures/dunning";
import { feeRunsRouter } from "~/server/orpc/procedures/fee-runs";
import { feeTypesRouter } from "~/server/orpc/procedures/fee-types";
import { importRouter } from "~/server/orpc/procedures/import";
import { membersRouter } from "~/server/orpc/procedures/members";
import { organizationSettingsRouter } from "~/server/orpc/procedures/organization-settings";
import { portalRouter } from "~/server/orpc/procedures/portal";
import { relationshipsRouter } from "~/server/orpc/procedures/relationships";
import { reportsRouter } from "~/server/orpc/procedures/reports";
import { sepaRouter } from "~/server/orpc/procedures/sepa";
import { sepaReturnsRouter } from "~/server/orpc/procedures/sepa-returns";
import { settingsRouter } from "~/server/orpc/procedures/settings";
import { snapshotsRouter } from "~/server/orpc/procedures/snapshots";
import { verbandsmeldungRouter } from "~/server/orpc/procedures/verbandsmeldung";

export const appRouter = {
  auth: authRouter,
  members: membersRouter,
  abteilungen: abteilungenRouter,
  relationships: relationshipsRouter,
  contracts: contractsRouter,
  feeTypes: feeTypesRouter,
  sepa: sepaRouter,
  sepaReturns: sepaReturnsRouter,
  dunning: dunningRouter,
  dashboard: dashboardRouter,
  audit: auditRouter,
  attachments: attachmentsRouter,
  banks: banksRouter,
  settings: settingsRouter,
  organization: organizationSettingsRouter,
  feeRuns: feeRunsRouter,
  import: importRouter,
  reports: reportsRouter,
  snapshots: snapshotsRouter,
  dsgvo: dsgvoRouter,
  verbandsmeldung: verbandsmeldungRouter,
  portal: portalRouter,
  dangerZone: dangerZoneRouter,
};

export type AppRouter = typeof appRouter;
