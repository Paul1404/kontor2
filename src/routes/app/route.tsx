import { useQuery } from "@tanstack/react-query";
import {
  CatchBoundary,
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { AppShell } from "~/components/layout/AppShell";
import { ErrorPanel, NotFoundPanel } from "~/components/layout/ErrorPanel";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app")({
  // Gate auth at the router layer so unauth'd users never even start
  // rendering the shell. SPA redirect — no full page reload.
  beforeLoad: async () => {
    try {
      const me = await orpc.auth.me();
      return { me };
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <ErrorPanel error={error} reset={reset} />
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <NotFoundPanel />
    </div>
  ),
});

function AppLayout() {
  // beforeLoad guarantees the cookie is valid; this query keeps role/email
  // in sync after sign-in and survives invalidations elsewhere.
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => orpc.auth.me(),
    retry: false,
  });
  // Reset the catch boundary on every navigation so a failed page doesn't
  // remain in the error state after the user moves elsewhere.
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (me.isLoading || !me.data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Wird geladen...
      </div>
    );
  }

  return (
    <AppShell role={me.data.role} userEmail={me.data.email}>
      <CatchBoundary
        getResetKey={() => pathname}
        errorComponent={({ error, reset }) => (
          <div className="flex min-h-[60vh] items-center justify-center">
            <ErrorPanel error={error} reset={reset} />
          </div>
        )}
      >
        <Outlet />
      </CatchBoundary>
    </AppShell>
  );
}
