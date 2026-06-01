import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { isUnauthorizedError, redirectToLoginExpired } from "~/lib/auth-redirect";
import { routeTree } from "~/routes/routeTree.gen";

let queryClient: QueryClient | undefined;
function getQueryClient(): QueryClient {
  if (!queryClient) {
    queryClient = new QueryClient({
      // Catch an expired session anywhere: if any query or mutation comes back
      // UNAUTHORIZED, bounce to login gracefully instead of surfacing a raw
      // error in the UI.
      queryCache: new QueryCache({
        onError: (err) => {
          if (isUnauthorizedError(err)) redirectToLoginExpired();
        },
      }),
      mutationCache: new MutationCache({
        onError: (err) => {
          if (isUnauthorizedError(err)) redirectToLoginExpired();
        },
      }),
      defaultOptions: {
        queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        mutations: { retry: 0 },
      },
    });
  }
  return queryClient;
}

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    Wrap: ({ children }: { children: ReactNode }) => <Providers>{children}</Providers>,
  });
}

export const createRouter = getRouter;

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
