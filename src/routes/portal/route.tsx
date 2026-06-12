import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useBranding } from "~/lib/branding";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/portal")({
  component: PortalLayout,
});

function PortalLayout() {
  const branding = useBranding();
  const me = useQuery({
    queryKey: ["portal.me"],
    queryFn: () => orpc.portal.me(),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-border">
              <img src={branding.logoSrc} alt="" className="size-8 object-contain" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">
                {me.data?.organization.vereinsname ?? "Mitgliederportal"}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Mitgliederportal
              </div>
            </div>
          </div>
          {me.data?.member ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Angemeldet als{" "}
                <strong>
                  {[me.data.member.vorname, me.data.member.nachname].filter(Boolean).join(" ") ||
                    "Mitglied"}
                </strong>
              </span>
              <a href="/api/portal/logout">
                <Button variant="outline" size="sm">
                  <LogOut className="size-4" /> Abmelden
                </Button>
              </a>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" /> verschlüsselt
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t mt-12 py-6">
        <div className="mx-auto max-w-3xl px-4 text-xs text-muted-foreground">
          {me.data?.organization.vereinsname ?? "Verein"} · Mitgliederportal · Zugriff über
          einmaligen Einladungslink
        </div>
      </footer>
    </div>
  );
}
