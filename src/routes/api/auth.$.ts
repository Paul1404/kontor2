import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

// Server imports are loaded lazily inside the handler, never at module top
// level: this route module is part of the client route tree, and a static
// `import { auth }` would drag the whole better-auth + mail + db graph
// (nodemailer touches the Node-only `Buffer`) into the browser bundle and
// break hydration. See the note in `api/rpc.$.ts`.
const handle = createServerOnlyFn(async ({ request }: { request: Request }) => {
  const [
    { auth },
    { dbForTenant },
    { requestHost },
    { resolveTenantFromHost },
    { guardAdminPluginRequest },
    { ensureSessionConfigLoaded },
    { runWithTenantKeyring },
  ] = await Promise.all([
    import("~/server/auth/auth"),
    import("~/server/db/client"),
    import("~/server/tenants/request-host"),
    import("~/server/tenants/resolve"),
    import("~/server/auth/last-admin-guard"),
    import("~/server/auth/session-config"),
    import("~/server/crypto/tenant-crypto"),
  ]);
  const tenant = resolveTenantFromHost(requestHost(request.headers));
  const tenantDb = dbForTenant(tenant.databaseUrl);
  await ensureSessionConfigLoaded(tenant.key, tenantDb);
  // Im Per-Verein-Keyring: better-auth sendet Invite-/Reset-Mails, die die
  // SMTP-Konfig dieses Vereins (verschlüsseltes Passwort) lesen.
  return runWithTenantKeyring(tenant.key, async () => {
    // Block last-admin-locking POSTs to the better-auth admin plugin
    // endpoints (set-user-banned / remove-user / set-role) before they reach
    // the plugin's handler. This is the catch-all for the catch-22 where an
    // admin could ban or remove themselves and leave the instance unreachable.
    // Checks this Verein's admins (per-tenant db).
    const guard = await guardAdminPluginRequest(tenantDb, request);
    if (guard) return guard;
    return auth(tenant).handler(request);
  });
});

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
});
