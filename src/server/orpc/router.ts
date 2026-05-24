import { abteilungenRouter } from "~/server/orpc/procedures/abteilungen";
import { attachmentsRouter } from "~/server/orpc/procedures/attachments";
import { auditRouter } from "~/server/orpc/procedures/audit";
import { authRouter } from "~/server/orpc/procedures/auth";
import { banksRouter } from "~/server/orpc/procedures/banks";
import { contractsRouter } from "~/server/orpc/procedures/contracts";
import { dashboardRouter } from "~/server/orpc/procedures/dashboard";
import { feeRunsRouter } from "~/server/orpc/procedures/fee-runs";
import { feeTypesRouter } from "~/server/orpc/procedures/fee-types";
import { importRouter } from "~/server/orpc/procedures/import";
import { membersRouter } from "~/server/orpc/procedures/members";
import { organizationSettingsRouter } from "~/server/orpc/procedures/organization-settings";
import { relationshipsRouter } from "~/server/orpc/procedures/relationships";
import { reportsRouter } from "~/server/orpc/procedures/reports";
import { sepaRouter } from "~/server/orpc/procedures/sepa";
import { settingsRouter } from "~/server/orpc/procedures/settings";
import { snapshotsRouter } from "~/server/orpc/procedures/snapshots";

export const appRouter = {
  auth: authRouter,
  members: membersRouter,
  abteilungen: abteilungenRouter,
  relationships: relationshipsRouter,
  contracts: contractsRouter,
  feeTypes: feeTypesRouter,
  sepa: sepaRouter,
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
};

export type AppRouter = typeof appRouter;
