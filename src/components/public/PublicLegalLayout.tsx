import { ArrowLeft, Mail } from "lucide-react";
import type { ReactNode } from "react";

export function PublicLegalLayout({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#inhalt"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Zum Inhalt
      </a>

      <header className="border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-5xl items-center justify-between px-5 sm:px-8">
          <a href="/" className="flex items-center gap-3" aria-label="Kontor2 Startseite">
            <img src="/logo.svg" alt="" className="size-9 rounded-xl shadow-soft" />
            <span className="font-display text-2xl font-semibold tracking-tight">Kontor²</span>
          </a>
          <a
            href="mailto:hallo@kontor2.com"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Mail className="size-4" />
            <span className="hidden sm:inline">hallo@kontor2.com</span>
            <span className="sm:hidden">Kontakt</span>
          </a>
        </div>
      </header>

      <main id="inhalt" className="px-5 py-14 sm:px-8 sm:py-20">
        <article className="mx-auto max-w-3xl">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Zur Produktseite
          </a>
          <p className="mt-12 text-sm font-semibold uppercase tracking-[0.18em] text-brand-accent">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            {title}
          </h1>
          {intro ? (
            <div className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">{intro}</div>
          ) : null}
          <div className="mt-14 space-y-12 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-brand-accent/60 [&_a]:underline-offset-4">
            {children}
          </div>
        </article>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>Kontor² · Vereinsverwaltung aus der Praxis</span>
          <nav aria-label="Rechtliches" className="flex items-center gap-5">
            <a href="/impressum" className="transition-colors hover:text-foreground">
              Impressum
            </a>
            <a href="/datenschutz" className="transition-colors hover:text-foreground">
              Datenschutz
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}
