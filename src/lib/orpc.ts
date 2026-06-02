import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { AppRouter } from "~/server/orpc/router";

// During SSR the oRPC client runs on the server and makes a loopback HTTP
// request to /api/rpc. `credentials: "include"` only attaches cookies in the
// browser, so without forwarding the inbound request's Cookie header the SSR
// call is unauthenticated. That made the /app auth gate (beforeLoad ->
// auth.me) fail on every full page load and bounce the user to /login, which
// looked like the session being invalidated whenever the site was reopened.
// On the server we forward the incoming Cookie header; in the browser the
// cookie jar handles it and there is nothing to inject.
const forwardedHeaders = createIsomorphicFn()
  .client((): Record<string, string> => ({}))
  .server((): Record<string, string> => {
    const cookie = getRequestHeaders().get("cookie");
    return cookie ? { cookie } : {};
  });

const link = new RPCLink({
  url() {
    if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
    return `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/rpc`;
  },
  headers: () => forwardedHeaders(),
  fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
});

export const orpc: RouterClient<AppRouter> = createORPCClient(link);
