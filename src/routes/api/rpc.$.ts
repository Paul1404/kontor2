import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

// API route modules are still pulled into the client route tree, and only the
// `server.handlers` *bodies* get stripped client-side -- top-level imports do
// not. A static `import { appRouter }` here dragged the entire server graph
// (every procedure -> mail/nodemailer, postgres, ioredis, @aws-sdk) into the
// browser bundle, where a module touching the Node-only `Buffer` global threw
// `Buffer is not defined` and killed hydration -- the login form rendered but
// no client JS ran, so submitting did nothing. Load the server pieces lazily
// inside the handler so nothing server-only is statically reachable from the
// client.
const handle = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
  const [{ RPCHandler }, { createContext }, { appRouter }, { runWithTenantKeyring }] =
    await Promise.all([
      import("@orpc/server/fetch"),
      import("~/server/orpc/context"),
      import("~/server/orpc/router"),
      import("~/server/crypto/tenant-crypto"),
    ]);
  const context = await createContext(request);
  // Alle Prozeduren laufen im Per-Verein-Keyring dieses Requests, damit
  // verschlüsselte Felder mit dem richtigen Schlüssel ver-/entschlüsselt werden.
  const { response } = await runWithTenantKeyring(context.tenant.key, () =>
    new RPCHandler(appRouter).handle(request, { prefix: "/api/rpc", context }),
  );
  return response ?? new Response("Not found", { status: 404 });
});

export const Route = createFileRoute("/api/rpc/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      DELETE: handle,
      PATCH: handle,
    },
  },
});
