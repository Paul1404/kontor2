import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "~/server/orpc/router";

const link = new RPCLink({
  url() {
    if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
    return `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/rpc`;
  },
  fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
});

export const orpc: RouterClient<AppRouter> = createORPCClient(link);
