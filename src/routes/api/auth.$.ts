import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/server/auth/auth";
import { ensureBootstrapAdmin } from "~/server/auth/bootstrap";

const handle = async ({ request }: { request: Request }) => {
  await ensureBootstrapAdmin();
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
