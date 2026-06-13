import { createFileRoute } from "@tanstack/react-router";

// Server imports are loaded lazily inside the handler, never at module top
// level: this route module is part of the client route tree, and a static
// `import { auth }` would drag the whole better-auth + mail + db graph
// (nodemailer touches the Node-only `Buffer`) into the browser bundle and
// break hydration. See the note in `api/rpc.$.ts`.
const handle = async ({ request }: { request: Request }) => {
  const [
    { auth },
    { resolveTenantFromHost },
    { guardAdminPluginRequest },
    { ensureSessionConfigLoaded },
  ] = await Promise.all([
    import("~/server/auth/auth"),
    import("~/server/tenants/resolve"),
    import("~/server/auth/last-admin-guard"),
    import("~/server/auth/session-config"),
  ]);
  await ensureSessionConfigLoaded();
  const tenant = resolveTenantFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  // Block last-admin-locking POSTs to the better-auth admin plugin
  // endpoints (set-user-banned / remove-user / set-role) before they reach
  // the plugin's handler. This is the catch-all for the catch-22 where an
  // admin could ban or remove themselves and leave the instance unreachable.
  const guard = await guardAdminPluginRequest(request);
  if (guard) return guard;
  return auth(tenant).handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
});
