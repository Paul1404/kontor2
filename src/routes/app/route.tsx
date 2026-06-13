import { useQuery } from "@tanstack/react-query";
import {
  CatchBoundary,
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "~/components/layout/AppShell";
import { ErrorPanel, NotFoundPanel } from "~/components/layout/ErrorPanel";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app")({
  // Gate auth at the router layer so unauth'd users never even start
  // rendering the shell. SPA redirect — no full page reload.
  beforeLoad: async ({ location }) => {
    let me: Awaited<ReturnType<typeof orpc.auth.me>>;
    try {
      me = await orpc.auth.me();
    } catch {
      // No valid session: send them to login with a note and a way back to
      // the page they were trying to reach.
      throw redirect({ to: "/login", search: { expired: true, redirect: location.href } });
    }
    // Operatoren des Betreiber-Realms gehören in die Console, nicht in die
    // Vereins-App (die hier auf der Control-DB ohnehin keine sinnvollen Daten hätte).
    if (me.tenant?.isOperator) throw redirect({ to: "/console" });
    return { me };
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
  const navigate = useNavigate();
  // beforeLoad guarantees the cookie is valid; this query keeps role/email
  // in sync after sign-in and survives invalidations elsewhere. One retry
  // absorbs a transient blip without bouncing the user to login.
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => orpc.auth.me(),
    retry: 1,
  });
  // Reset the catch boundary on every navigation so a failed page doesn't
  // remain in the error state after the user moves elsewhere.
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // The session can lapse while the app is open: the 5-minute cookie cache lets
  // `beforeLoad` pass without re-reading the session store, so we can land here
  // holding a cookie that no longer maps to a live session. When the `me` query
  // then fails, don't hang on the loading state forever — send the user to
  // login, the same recovery `beforeLoad` does on a hard miss.
  useEffect(() => {
    if (me.isError) {
      navigate({ to: "/login", search: { expired: true, redirect: pathname } });
    }
  }, [me.isError, navigate, pathname]);

  if (me.isError) {
    return null;
  }

  if (me.isLoading || !me.data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Wird geladen…
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
