import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/server/auth/auth";
import { ensureBootstrapAdmin } from "~/server/auth/bootstrap";
import { guardAdminPluginRequest } from "~/server/auth/last-admin-guard";

const handle = async ({ request }: { request: Request }) => {
  await ensureBootstrapAdmin();
  // Block last-admin-locking POSTs to the better-auth admin plugin
  // endpoints (set-user-banned / remove-user / set-role) before they reach
  // the plugin's handler. This is the catch-all for the catch-22 where an
  // admin could ban or remove themselves and leave the instance unreachable.
  const guard = await guardAdminPluginRequest(request);
  if (guard) return guard;
  return auth().handler(request);
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
