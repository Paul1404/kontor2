import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Building2, LogOut } from "lucide-react";
import { Button } from "~/components/ui/button";
import { signOut } from "~/lib/auth-client";
import { orpc } from "~/lib/orpc";

/**
 * Betreiber-Console: eigene Welt für den Software-Betreiber, getrennt von jedem
 * Verein. Läuft auf `admin.<domain>` (Operator-Realm der Control-DB). Gated auf
 * eingeloggte Operator-Accounts; Nicht-Operatoren werden in die Vereins-App
 * geschickt.
 */
export const Route = createFileRoute("/console")({
  beforeLoad: async ({ location }) => {
    let me: Awaited<ReturnType<typeof orpc.auth.me>>;
    try {
      me = await orpc.auth.me();
    } catch {
      throw redirect({ to: "/login", search: { expired: true, redirect: location.href } });
    }
    // Kein Operator (normaler Vereins-Account) -> ab in die Vereins-App.
    if (!me.tenant?.isOperator) throw redirect({ to: "/app" });
    return { me };
  },
  component: ConsoleLayout,
});

function ConsoleLayout() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me(), retry: 1 });
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Building2 className="size-5 text-brand" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">Kontor2 Betreiber</span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Vereinsverwaltung
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{me.data?.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut().then(() => window.location.assign("/login"))}
            >
              <LogOut className="size-4" /> Abmelden
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
