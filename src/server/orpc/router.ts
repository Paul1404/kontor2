import { abteilungenRouter } from "~/server/orpc/procedures/abteilungen";
import { apiKeysRouter } from "~/server/orpc/procedures/api-keys";
import { applicationsRouter } from "~/server/orpc/procedures/applications";
import { attachmentsRouter } from "~/server/orpc/procedures/attachments";
import { auditRouter } from "~/server/orpc/procedures/audit";
import { authRouter } from "~/server/orpc/procedures/auth";
import { banksRouter } from "~/server/orpc/procedures/banks";
import { cancellationsRouter } from "~/server/orpc/procedures/cancellations";
import { contractsRouter } from "~/server/orpc/procedures/contracts";
import { dangerZoneRouter } from "~/server/orpc/procedures/danger-zone";
import { dashboardRouter } from "~/server/orpc/procedures/dashboard";
import { dataQualityRouter } from "~/server/orpc/procedures/data-quality";
import { dsgvoRouter } from "~/server/orpc/procedures/dsgvo";
import { dunningRouter } from "~/server/orpc/procedures/dunning";
import { ehrungenRouter } from "~/server/orpc/procedures/ehrungen";
import { emailLogRouter } from "~/server/orpc/procedures/email-log";
import { familienRouter } from "~/server/orpc/procedures/familien";
import { feeRunsRouter } from "~/server/orpc/procedures/fee-runs";
import { feeTypesRouter } from "~/server/orpc/procedures/fee-types";
import { importRouter } from "~/server/orpc/procedures/import";
import { invoicesRouter } from "~/server/orpc/procedures/invoices";
import { kulanzRouter } from "~/server/orpc/procedures/kulanz";
import { logsRouter } from "~/server/orpc/procedures/logs";
import { membersRouter } from "~/server/orpc/procedures/members";
import { organizationSettingsRouter } from "~/server/orpc/procedures/organization-settings";
import { paymentsRouter } from "~/server/orpc/procedures/payments";
import { portalRouter } from "~/server/orpc/procedures/portal";
import { relationshipsRouter } from "~/server/orpc/procedures/relationships";
import { reportsRouter } from "~/server/orpc/procedures/reports";
import { rundschreibenRouter } from "~/server/orpc/procedures/rundschreiben";
import { searchRouter } from "~/server/orpc/procedures/search";
import { sepaRouter } from "~/server/orpc/procedures/sepa";
import { sepaReturnsRouter } from "~/server/orpc/procedures/sepa-returns";
import { settingsRouter } from "~/server/orpc/procedures/settings";
import { snapshotsRouter } from "~/server/orpc/procedures/snapshots";
import { tasksRouter } from "~/server/orpc/procedures/tasks";
import { tenantsRouter } from "~/server/orpc/procedures/tenants";
import { timelineRouter } from "~/server/orpc/procedures/timeline";
import { verbandsmeldungRouter } from "~/server/orpc/procedures/verbandsmeldung";

export const appRouter = {
  auth: authRouter,
  members: membersRouter,
  applications: applicationsRouter,
  abteilungen: abteilungenRouter,
  apiKeys: apiKeysRouter,
  relationships: relationshipsRouter,
  familien: familienRouter,
  contracts: contractsRouter,
  feeTypes: feeTypesRouter,
  sepa: sepaRouter,
  sepaReturns: sepaReturnsRouter,
  dunning: dunningRouter,
  ehrungen: ehrungenRouter,
  kulanz: kulanzRouter,
  dashboard: dashboardRouter,
  dataQuality: dataQualityRouter,
  audit: auditRouter,
  logs: logsRouter,
  emailLog: emailLogRouter,
  attachments: attachmentsRouter,
  banks: banksRouter,
  cancellations: cancellationsRouter,
  settings: settingsRouter,
  organization: organizationSettingsRouter,
  feeRuns: feeRunsRouter,
  invoices: invoicesRouter,
  payments: paymentsRouter,
  import: importRouter,
  reports: reportsRouter,
  search: searchRouter,
  rundschreiben: rundschreibenRouter,
  snapshots: snapshotsRouter,
  tasks: tasksRouter,
  tenants: tenantsRouter,
  timeline: timelineRouter,
  dsgvo: dsgvoRouter,
  verbandsmeldung: verbandsmeldungRouter,
  portal: portalRouter,
  dangerZone: dangerZoneRouter,
};

export type AppRouter = typeof appRouter;
