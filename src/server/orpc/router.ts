import { authRouter } from "~/server/orpc/procedures/auth";
import { auditRouter } from "~/server/orpc/procedures/audit";
import { attachmentsRouter } from "~/server/orpc/procedures/attachments";
import { dashboardRouter } from "~/server/orpc/procedures/dashboard";
import { importRouter } from "~/server/orpc/procedures/import";
import { membersRouter } from "~/server/orpc/procedures/members";
import { settingsRouter } from "~/server/orpc/procedures/settings";

export const appRouter = {
  auth: authRouter,
  members: membersRouter,
  dashboard: dashboardRouter,
  audit: auditRouter,
  attachments: attachmentsRouter,
  settings: settingsRouter,
  import: importRouter,
};

export type AppRouter = typeof appRouter;
