import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  ArrowRight,
  Banknote,
  Check,
  ChevronRight,
  CircleCheckBig,
  ClipboardCheck,
  Database,
  FileCheck2,
  History,
  Landmark,
  LockKeyhole,
  type LucideIcon,
  Mail,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import { isPublicProductRequest } from "~/lib/current-product-host";

const CONTACT_HREF =
  "mailto:hallo@kontor2.com?subject=Interesse%20an%20Kontor2&body=Hallo%20Paul%2C%0A%0Awir%20interessieren%20uns%20f%C3%BCr%20Kontor2.%0A%0AVerein%3A%0AMitgliederzahl%3A%0AAbteilungen%3A%0AAktuelle%20L%C3%B6sung%3A%0AWichtigste%20Anforderungen%3A%0A%0AViele%20Gr%C3%BC%C3%9Fe";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // Club and operator hosts keep their established entry into the application.
    // Only the product apex receives the public site.
    if (!isPublicProductRequest()) throw redirect({ to: "/app" });
  },
  head: () => ({
    links: [{ rel: "canonical", href: "https://kontor2.com/" }],
  }),
  component: ProductHomePage,
});

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const WORKFLOWS: Feature[] = [
  {
    icon: Banknote,
    title: "Rücklastschriften zu Ende gedacht",
    description:
      "Bankdatei zuordnen, Forderung wieder öffnen, Gebühren erfassen, erneut einziehen oder nachvollziehbar mahnen.",
  },
  {
    icon: Scale,
    title: "Datenschutz als echter Ablauf",
    description:
      "Auskunft und Löschung mit Fristen, Vorschau, Aufbewahrungsregeln und dokumentiertem Ergebnis.",
  },
  {
    icon: History,
    title: "Änderungen bleiben erklärbar",
    description:
      "Bearbeitungen nachvollziehen, Datenstände vergleichen und einzelne Felder gezielt wiederherstellen.",
  },
];

const PRINCIPLES: Feature[] = [
  {
    icon: Workflow,
    title: "Vollständige Abläufe",
    description:
      "Kontor2 verbindet Vorschau, Prüfung, Ausführung und Korrektur. Schwierige Fälle enden nicht in einer Notizliste.",
  },
  {
    icon: Database,
    title: "Getrennte Vereinsdaten",
    description:
      "Jeder Verein erhält eine eigene Datenbank, eigene Benutzerkonten und einen eigenen Verschlüsselungsschlüssel.",
  },
  {
    icon: FileCheck2,
    title: "Historie mit Herkunft",
    description:
      "Alte Beiträge, Forderungen und Zahlungen bleiben erhalten. Eine Migration löscht nicht die Geschichte des Vereins.",
  },
  {
    icon: ClipboardCheck,
    title: "Datenqualität im Alltag",
    description:
      "Fachliche Prüfungen finden fehlende Mandate, unplausible Verträge, Dubletten und vergessene Ausnahmen.",
  },
];

const GOOD_FIT = [
  "Sportverein mit etwa 100 bis 500 Mitgliedern",
  "Eine zentrale Mitgliederverwaltung",
  "Mitgliedsbeiträge überwiegend per SEPA",
  "Eine verantwortliche Ansprechperson im Vorstand",
  "Bestehende Daten aus Excel, CSV oder einem Altsystem",
  "Bereitschaft zu persönlicher Einführung und Rückmeldung",
];

const NOT_YET = [
  "Vollständige Finanz- oder Steuerbuchhaltung",
  "Kurs-, Trainings- oder Platzplanung",
  "Mehrere rechtlich unabhängige Vereine in einer Instanz",
  "Garantierte Reaktionszeiten oder Verfügbarkeitszusagen",
];

function ProductHomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <a
        href="#inhalt"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Zum Inhalt
      </a>

      <header className="relative z-30 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
          <a href="#top" className="flex items-center gap-3" aria-label="Kontor2 Startseite">
            <img src="/logo.svg" alt="" className="size-9 rounded-xl shadow-soft" />
            <span className="font-display text-2xl font-semibold tracking-tight">Kontor²</span>
          </a>

          <nav aria-label="Hauptnavigation" className="hidden items-center gap-7 md:flex">
            <a
              href="#arbeitsalltag"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Arbeitsalltag
            </a>
            <a
              href="#besonders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Was Kontor2 auszeichnet
            </a>
            <a
              href="#pilot"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Pilotphase
            </a>
          </nav>

          <a href={CONTACT_HREF} className={buttonVariants({ size: "sm" })}>
            Interesse anmelden
          </a>
        </div>
      </header>

      <main id="inhalt">
        <section id="top" className="relative isolate overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_24%,color-mix(in_oklab,var(--color-brand-accent)_22%,transparent),transparent_32%),radial-gradient(circle_at_16%_12%,color-mix(in_oklab,var(--color-primary)_10%,transparent),transparent_28%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]"
          />

          <div className="mx-auto grid max-w-7xl gap-14 px-5 py-18 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:py-30">
            <div className="max-w-3xl motion-fade-in">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-accent/35 bg-card/80 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-soft">
                <Sparkles className="size-3.5 text-brand-accent" />
                Begleitete Pilotphase für Sportvereine
              </div>

              <h1 className="max-w-3xl text-4xl font-semibold leading-[1.04] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
                Vereinsverwaltung für den echten Verwaltungsalltag.
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                Kontor2 ist aus der praktischen Arbeit eines Sportvereins entstanden. Es verbindet
                Mitglieder, Beiträge, SEPA, Forderungen und Datenschutz in nachvollziehbaren
                Abläufen.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href={CONTACT_HREF} className={buttonVariants({ size: "lg" })}>
                  Als Pilotverein anfragen
                  <ArrowRight className="size-4" />
                </a>
                <a
                  href="#arbeitsalltag"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  Kontor2 kennenlernen
                </a>
              </div>

              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Check className="size-4 text-success" /> Im Vereinsbetrieb entwickelt
                </span>
                <span className="inline-flex items-center gap-2">
                  <Check className="size-4 text-success" /> Persönlich begleitet
                </span>
                <span className="inline-flex items-center gap-2">
                  <Check className="size-4 text-success" /> Keine offene Registrierung
                </span>
              </div>
            </div>

            <ProductPreview />
          </div>
        </section>

        <section className="border-y border-border bg-card">
          <div className="mx-auto grid max-w-7xl divide-y divide-border px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0 lg:px-10">
            <Fact value="Ein Verein" label="hat Kontor2 aus der Praxis heraus geprägt" />
            <Fact value="Ein Ablauf" label="von der Aufnahme bis zur nachvollziehbaren Korrektur" />
            <Fact
              value="Eine Historie"
              label="die bei Migrationen und Änderungen erhalten bleibt"
            />
          </div>
        </section>

        <section id="arbeitsalltag" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <SectionHeading
              eyebrow="Nicht nur für den Normalfall"
              title="Kontor2 macht dort weiter, wo Verwaltungssoftware oft aufhört."
              description="Entscheidend ist nicht die Zahl der Menüpunkte. Entscheidend ist, ob ein Vorgang vom ersten Hinweis bis zum sauberen Abschluss begleitet wird."
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {WORKFLOWS.map((item, index) => (
                <WorkflowCard key={item.title} item={item} number={index + 1} />
              ))}
            </div>
          </div>
        </section>

        <section id="besonders" className="scroll-mt-20 bg-secondary/55 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <SectionHeading
              eyebrow="Aus der Praxis gebaut"
              title="Nicht bloß Daten speichern. Verantwortung abbilden."
              description="Kontor2 behandelt Verwaltung als nachvollziehbare Fallarbeit. Herkunft, Zeitbezug und Korrekturen gehören zum Datensatz dazu."
            />

            <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-border bg-border shadow-card sm:grid-cols-2">
              {PRINCIPLES.map((item) => (
                <div key={item.title} className="bg-card p-7 sm:p-9">
                  <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
                    <item.icon className="size-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-3 max-w-lg leading-7 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <ArchitectureSection />

        <section id="pilot" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-accent">
                  Begleitete Pilotphase
                </p>
                <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                  Wenige Vereine. Persönliche Einführung.
                </h2>
                <p className="mt-6 text-lg leading-8 text-muted-foreground">
                  Kontor2 ist bereits im praktischen Vereinsbetrieb. Für weitere Vereine erfolgt die
                  Einführung derzeit bewusst persönlich und in begrenzter Zahl.
                </p>
                <div className="mt-8 rounded-2xl border border-brand-accent/35 bg-brand-accent/10 p-5">
                  <p className="font-medium">Warum keine offene Registrierung?</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Eine Vereinsverwaltung beginnt mit Daten, Beitragsregeln und Verantwortung. Das
                    verdient mehr als einen anonymen Importassistenten.
                  </p>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <FitCard
                  icon={CircleCheckBig}
                  title="Passt derzeit besonders gut"
                  items={GOOD_FIT}
                  positive
                />
                <FitCard icon={X} title="Noch nicht der Schwerpunkt" items={NOT_YET} />
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <SectionHeading
              eyebrow="So beginnt ein Pilot"
              title="Erst verstehen, dann übertragen."
              description="Bevor Daten umziehen, prüfen wir gemeinsam, ob Kontor2 wirklich zum Verein und seinen Abläufen passt."
              centered
            />
            <ol className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-4">
              {[
                ["01", "Kennenlernen", "Verein, Arbeitsweise und Erwartungen kurz einordnen."],
                [
                  "02",
                  "Bestand prüfen",
                  "Datenquelle, Beiträge und Sonderfälle gemeinsam ansehen.",
                ],
                ["03", "Testlauf", "Daten isoliert übernehmen und mit dem Verein abstimmen."],
                [
                  "04",
                  "Begleiteter Start",
                  "Erste echte Abläufe gemeinsam und kontrolliert durchführen.",
                ],
              ].map(([number, title, text]) => (
                <li
                  key={number}
                  className="relative rounded-2xl border border-border bg-background p-6"
                >
                  <span className="font-display text-3xl text-brand-accent">{number}</span>
                  <h3 className="mt-8 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-primary px-6 py-14 text-primary-foreground shadow-elevated sm:px-12 sm:py-18 lg:px-18">
            <div
              aria-hidden
              className="absolute -right-24 -top-28 size-80 rounded-full border border-white/10"
            />
            <div
              aria-hidden
              className="absolute -right-8 -top-10 size-52 rounded-full border border-white/10"
            />
            <div className="relative max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-accent">
                Interesse an Kontor2?
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                Erzählt uns kurz von eurem Verein.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-primary-foreground/75">
                Mitgliederzahl, Abteilungen, bisherige Lösung und die Aufgaben, die euch am meisten
                Zeit kosten. Wir melden uns persönlich und sagen ehrlich, ob Kontor2 bereits passt.
              </p>
              <a
                href={CONTACT_HREF}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "mt-8 bg-brand-accent text-[#14223d] hover:bg-brand-accent/90",
                )}
              >
                <Mail className="size-4" />
                hallo@kontor2.com
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="size-7 rounded-lg" />
            <span>Kontor² · Vereinsverwaltung aus der Praxis</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href={CONTACT_HREF} className="transition-colors hover:text-foreground">
              Kontakt
            </a>
            <a href="/impressum" className="transition-colors hover:text-foreground">
              Impressum
            </a>
            <a href="/datenschutz" className="transition-colors hover:text-foreground">
              Datenschutz
            </a>
            <span>© 2026 Kontor²</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ProductPreview() {
  const rows = [
    {
      icon: Banknote,
      title: "Beitragslauf geprüft",
      detail: "SEPA und Rechnungszahler",
      state: "Bereit",
    },
    {
      icon: UserRoundCheck,
      title: "Datenqualität",
      detail: "Hinweise mit direkter Klärung",
      state: "Im Blick",
    },
    {
      icon: History,
      title: "Änderungsprotokoll",
      detail: "Herkunft und Verlauf",
      state: "Lückenlos",
    },
  ];

  return (
    <div className="relative mx-auto w-full max-w-xl lg:mx-0 lg:ml-auto">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-brand-accent/10 blur-2xl"
      />
      <div className="overflow-hidden rounded-[1.75rem] border border-border/90 bg-card shadow-elevated">
        <div className="flex items-center justify-between border-b border-border bg-primary px-6 py-5 text-primary-foreground">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-primary-foreground/60">
              Verwaltungsübersicht
            </p>
            <p className="mt-1 font-display text-2xl">Heute im Blick</p>
          </div>
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/10">
            <Landmark className="size-5 text-brand-accent" />
          </div>
        </div>

        <div className="space-y-3 p-5 sm:p-6">
          {rows.map((row) => (
            <div
              key={row.title}
              className="flex items-center gap-4 rounded-xl border border-border bg-background/65 p-4"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <row.icon className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{row.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.detail}</p>
              </div>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                {row.state}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 border-t border-border bg-secondary/45">
          <div className="border-r border-border p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-success" /> Vereinsdaten
            </div>
            <p className="mt-2 font-medium">Eigene Datenbank</p>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCcw className="size-4 text-brand-accent" /> Datenstände
            </div>
            <p className="mt-2 font-medium">Wiederherstellbar</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-5 -left-3 hidden items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-elevated sm:flex">
        <CircleCheckBig className="size-5 text-success" />
        <div>
          <p className="text-xs font-medium">Nachvollziehbar abgeschlossen</p>
          <p className="text-[11px] text-muted-foreground">Mit Vorschau und Protokoll</p>
        </div>
      </div>
    </div>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-7 text-center md:px-8 md:py-9">
      <p className="font-display text-2xl font-semibold">{value}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  centered?: boolean;
}) {
  return (
    <div className={cn("max-w-3xl", centered && "mx-auto text-center")}>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-accent">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        {title}
      </h2>
      <p className="mt-5 text-lg leading-8 text-muted-foreground">{description}</p>
    </div>
  );
}

function WorkflowCard({ item, number }: { item: Feature; number: number }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-card transition-transform duration-200 hover:-translate-y-1 sm:p-8">
      <div className="flex items-center justify-between">
        <div className="flex size-12 items-center justify-center rounded-xl bg-secondary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <item.icon className="size-5" />
        </div>
        <span className="font-display text-4xl text-border">0{number}</span>
      </div>
      <h3 className="mt-8 text-xl font-semibold">{item.title}</h3>
      <p className="mt-3 leading-7 text-muted-foreground">{item.description}</p>
      <div className="mt-7 flex items-center gap-2 text-sm font-medium text-foreground">
        Ein vollständiger Vorgang
        <ChevronRight className="size-4 text-brand-accent" />
      </div>
    </article>
  );
}

function ArchitectureSection() {
  return (
    <section className="relative overflow-hidden bg-[#0b1322] py-20 text-[#f6f3ec] sm:py-28">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,#f6f3ec_1px,transparent_1px),linear-gradient(to_bottom,#f6f3ec_1px,transparent_1px)] [background-size:56px_56px]"
      />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-20 lg:px-10">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#c7a872]">
            Technisch getrennt
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Jeder Verein hat seinen eigenen Raum.
          </h2>
          <p className="mt-6 text-lg leading-8 text-[#f6f3ec]/68">
            Die Vereine teilen sich die Anwendung, nicht ihre Daten. Datenbank, Anmeldung und
            Verschlüsselung werden je Verein getrennt geführt.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-[#f6f3ec]/78">
            <TechPoint icon={Database}>Eigene PostgreSQL-Datenbank</TechPoint>
            <TechPoint icon={LockKeyhole}>Eigener Verschlüsselungsschlüssel</TechPoint>
            <TechPoint icon={UsersRound}>Eigene Benutzer und Rollen</TechPoint>
            <TechPoint icon={ShieldCheck}>Serverseitig geprüfte Berechtigungen</TechPoint>
          </ul>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur sm:p-7">
          <div className="mb-5 flex items-center justify-between text-xs text-[#f6f3ec]/55">
            <span>kontor2.com</span>
            <span className="rounded-full border border-[#c7a872]/35 bg-[#c7a872]/10 px-2.5 py-1 text-[#c7a872]">
              Mehrmandantenfähig
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["svu", "verein-a", "verein-b"].map((club, index) => (
              <div key={club} className="rounded-2xl border border-white/10 bg-[#14223d] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-white/8">
                    <Landmark className="size-4 text-[#c7a872]" />
                  </div>
                  <span className="size-2 rounded-full bg-emerald-400" />
                </div>
                <p className="mt-5 text-sm font-medium">{club}.kontor2.com</p>
                <div className="mt-4 space-y-2 text-[11px] text-[#f6f3ec]/55">
                  <div className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2.5 py-2">
                    <Database className="size-3" /> Datenbank {index + 1}
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2.5 py-2">
                    <LockKeyhole className="size-3" /> Schlüssel {index + 1}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-xs text-[#f6f3ec]/60">
            <ShieldCheck className="size-4 text-emerald-400" />
            Betreiberzugang und Vereinszugänge bleiben voneinander getrennt.
          </div>
        </div>
      </div>
    </section>
  );
}

function TechPoint({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.07]">
        <Icon className="size-4 text-[#c7a872]" />
      </span>
      {children}
    </li>
  );
}

function FitCard({
  icon: Icon,
  title,
  items,
  positive = false,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
  positive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7">
      <div
        className={cn(
          "flex size-11 items-center justify-center rounded-xl",
          positive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </div>
      <h3 className="mt-6 text-lg font-semibold">{title}</h3>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
            {positive ? (
              <Check className="mt-1 size-4 shrink-0 text-success" />
            ) : (
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            )}
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
