import { createFileRoute } from "@tanstack/react-router";
import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "~/server/orpc/router";
import { createContext } from "~/server/orpc/context";

const handler = new RPCHandler(appRouter);

async function handle({ request }: { request: Request }): Promise<Response> {
  const context = await createContext(request);
  const { response } = await handler.handle(request, { prefix: "/api/rpc", context });
  return response ?? new Response("Not found", { status: 404 });
}

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
