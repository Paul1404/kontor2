import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/antrag")({
  component: AntragLayout,
});

function AntragLayout() {
  const settings = useQuery({
    queryKey: ["applications.publicSettings"],
    queryFn: () => orpc.applications.publicSettings(),
    retry: false,
  });
  const vereinsname = settings.data?.vereinsname ?? "Verein";

  return (
    <div className="min-h-screen text-foreground">
      <header className="brand-gradient-bg relative overflow-hidden text-white shadow-elevated">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.25),transparent_60%)]" />
        <div className="relative mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-white/30">
              <img src="/logo.png" alt="" className="size-8 object-contain" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">{vereinsname}</div>
              <div className="text-[11px] uppercase tracking-wider text-white/80">
                Online-Beitrittserklärung
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-white/90">
            <ShieldCheck className="size-3.5" /> verschlüsselt
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="mt-12 border-t py-6">
        <div className="mx-auto max-w-3xl px-4 text-xs text-muted-foreground">{vereinsname}</div>
      </footer>
    </div>
  );
}
