import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/server/auth/auth";

const handle = ({ request }: { request: Request }) => auth().handler(request);

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
});
