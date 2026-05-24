import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "~/components/layout/AppShell";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    // Initial cookie-based session check: we rely on the server to redirect
    // unauth'd users via the rpc 401. The actual gate is the me() query below.
    return {};
  },
  component: AppLayout,
});

function AppLayout() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => orpc.auth.me(),
    retry: false,
  });

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Wird geladen...
      </div>
    );
  }
  if (me.isError || !me.data) {
    if (typeof window !== "undefined") window.location.assign("/login");
    throw redirect({ to: "/login" });
  }

  return (
    <AppShell role={me.data.role} userEmail={me.data.email}>
      <Outlet />
    </AppShell>
  );
}
