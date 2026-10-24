import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Mail, Phone, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useBranding } from "~/lib/branding";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/antrag")({
  component: AntragLayout,
});

function AntragLayout() {
  useEffect(() => {
    // Keep all other clubs, authenticated pages and follow-up routes untracked.
    if (location.hostname !== "svu.kontor2.com" || !/^\/antrag\/?$/.test(location.pathname)) return;
    const script = document.createElement("script");
    script.src = "/analytics-consent.js";
    script.dataset.websiteId = "35888d1d-623f-40d4-86b2-d4fd181074f3";
    script.dataset.hosts = "svu.kontor2.com";
    script.dataset.onlyPath = "/antrag";
    script.dataset.privacy = "https://sv-untereuerheim.de/datenschutz/#analyse";
    document.body.append(script);
    return () => {
      script.remove();
      // The recorder has no stop API. Discard its observers on SPA departure.
      const consent = (window as unknown as { siteAnalyticsConsent?: { destroy: () => void } })
        .siteAnalyticsConsent;
      consent?.destroy();
    };
  }, []);
  const branding = useBranding();
  const settings = useQuery({
    queryKey: ["applications.publicSettings"],
    queryFn: () => orpc.applications.publicSettings(),
    retry: false,
  });
  const s = settings.data;
  const vereinsname = s?.vereinsname ?? "Verein";
  const anschrift = [
    s?.anschriftStrasse,
    [s?.anschriftPlz, s?.anschriftOrt].filter(Boolean).join(" "),
  ]
    .filter((p) => p?.trim())
    .join(", ");

  return (
    <div className="min-h-screen text-foreground">
      <header className="brand-gradient-bg relative overflow-hidden text-white shadow-elevated">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.25),transparent_60%)]" />
        <div className="relative mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-white/30">
              <img src={branding.logoSrc} alt="" className="size-8 object-contain" />
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
      <main className="rr-block mx-auto max-w-3xl px-4 py-6" data-private="true">
        <Outlet />
      </main>
      <footer className="mt-12 border-t py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{vereinsname}</span>
            {anschrift ? <span>{anschrift}</span> : null}
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            {s?.kontaktEmail ? (
              <a
                href={`mailto:${s.kontaktEmail}`}
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Mail className="size-3.5" /> {s.kontaktEmail}
              </a>
            ) : null}
            {s?.kontaktTelefon ? (
              <a
                href={`tel:${s.kontaktTelefon.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Phone className="size-3.5" /> {s.kontaktTelefon}
              </a>
            ) : null}
            <div className="flex gap-3">
              {s?.datenschutzUrl ? (
                <a
                  href={s.datenschutzUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground hover:underline"
                >
                  Datenschutz
                </a>
              ) : null}
              {s?.satzungUrl ? (
                <a
                  href={s.satzungUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground hover:underline"
                >
                  Satzung
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
