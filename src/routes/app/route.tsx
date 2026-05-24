import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "~/components/layout/AppShell";
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
});

function AppLayout() {
  // beforeLoad guarantees the cookie is valid; this query keeps role/email
  // in sync after sign-in and survives invalidations elsewhere.
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => orpc.auth.me(),
    retry: false,
  });

  if (me.isLoading || !me.data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Wird geladen...
      </div>
    );
  }

  return (
    <AppShell role={me.data.role} userEmail={me.data.email}>
      <Outlet />
    </AppShell>
  );
}
