import { authRouter } from "~/server/orpc/procedures/auth";
import { auditRouter } from "~/server/orpc/procedures/audit";
import { attachmentsRouter } from "~/server/orpc/procedures/attachments";
import { contractsRouter } from "~/server/orpc/procedures/contracts";
import { dashboardRouter } from "~/server/orpc/procedures/dashboard";
import { feeRunsRouter } from "~/server/orpc/procedures/fee-runs";
import { importRouter } from "~/server/orpc/procedures/import";
import { membersRouter } from "~/server/orpc/procedures/members";
import { organizationSettingsRouter } from "~/server/orpc/procedures/organization-settings";
import { relationshipsRouter } from "~/server/orpc/procedures/relationships";
import { sepaRouter } from "~/server/orpc/procedures/sepa";
import { settingsRouter } from "~/server/orpc/procedures/settings";

export const appRouter = {
  auth: authRouter,
  members: membersRouter,
  relationships: relationshipsRouter,
  contracts: contractsRouter,
  sepa: sepaRouter,
  dashboard: dashboardRouter,
  audit: auditRouter,
  attachments: attachmentsRouter,
  settings: settingsRouter,
  organization: organizationSettingsRouter,
  feeRuns: feeRunsRouter,
  import: importRouter,
};

export type AppRouter = typeof appRouter;
