import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Banknote,
  BookOpen,
  CheckCircle2,
  Coins,
  FileWarning,
  HeartHandshake,
  Info,
  Landmark,
  ListChecks,
  Mail,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  TriangleAlert,
  UserCog,
} from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "~/components/layout/PageHeader";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { cn } from "~/lib/cn";
import { EMPTY_VALUE, formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/dokumentation")({
  component: DokumentationPage,
});

const linkBtn = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5");
const linkBtnPrimary = cn(buttonVariants({ size: "sm" }), "gap-1.5");

/** One entry in the lifecycle overview, doubling as the table of contents. */
const LIFECYCLE: { id: string; step: number; icon: ReactNode; title: string; teaser: string }[] = [
  {
    id: "beitragslauf",
    step: 1,
    icon: <Coins className="size-4" />,
    title: "Beitragslauf: Sollstellungen erzeugen",
    teaser: "Beiträge für ein Jahr buchen und die SEPA-Datei erstellen.",
  },
  {
    id: "zahlungen",
    step: 2,
    icon: <Banknote className="size-4" />,
    title: "Zahlungen und SEPA",
    teaser: "Lastschrift wird erst nach bestätigtem Bankupload als eingezogen gebucht.",
  },
  {
    id: "ruecklaeufer",
    step: 3,
    icon: <RotateCcw className="size-4" />,
    title: "Rückläufer erfassen",
    teaser: "Geplatzte Lastschriften zurückbuchen und wieder offen stellen.",
  },
  {
    id: "forderungen",
    step: 4,
    icon: <FileWarning className="size-4" />,
    title: "Forderungen im Blick",
    teaser: "Alle offenen Posten, gefiltert nach Mahnstufe.",
  },
  {
    id: "mahnlauf",
    step: 5,
    icon: <Send className="size-4" />,
    title: "Mahnlauf durchführen",
    teaser: "Erinnerung, 1. Mahnung, 2. Mahnung erzeugen und versenden.",
  },
  {
    id: "kulanz",
    step: 6,
    icon: <HeartHandshake className="size-4" />,
    title: "Kulanz-Brief",
    teaser: "Zahlen oder kündigen. Bei Kündigung wird auf die Forderung verzichtet.",
  },
];

function DokumentationPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const canSeeDunning = me.data?.role === "vorstand" || me.data?.role === "admin";

  const org = useQuery({ queryKey: ["organization.get"], queryFn: () => orpc.organization.get() });
  const open = useQuery({
    queryKey: ["dunning.open", null],
    queryFn: () => orpc.dunning.open({}),
    enabled: canSeeDunning,
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        eyebrow="Handbuch"
        title="Dokumentation"
        description="Anleitungen für die wiederkehrenden Abläufe im Verein. Erstes Kapitel: von der Beitragsbuchung über Mahnungen bis zum Kulanz-Brief. Weitere Kapitel folgen."
        icon={<BookOpen className="size-6" />}
      />

      <InfoBox title="So ist dieses Kapitel aufgebaut" icon={Info}>
        <p>
          Der Abschnitt folgt dem Weg eines Beitrags durch das Jahr: erst die Sollstellung, dann
          Einzug und Rückläufer, schließlich das Mahnwesen und als letzter, freiwilliger Schritt der
          Kulanz-Brief. Jeder Schritt nennt den genauen Klickpfad und verlinkt direkt auf die
          passende Seite. Die Kachel „Aktueller Stand“ zeigt dabei die echten Zahlen und
          Einstellungen Ihres Vereins.
        </p>
      </InfoBox>

      {/* Live status pulled from the club's real configuration and open postings. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5 text-muted-foreground" />
            Aktueller Stand
          </CardTitle>
          <CardDescription>Live aus Ihrem Verein. Das ist die Ausgangslage gerade.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {org.data === null ? (
            <InfoBox tone="warning" title="Vereinsdaten fehlen" icon={TriangleAlert}>
              <p className="mb-2">
                Ohne Vereinsdaten (Bankverbindung, Mahngebühren, Fristen) lässt sich kein Mahnlauf
                starten. Bitte zuerst hinterlegen.
              </p>
              <Link to="/app/einstellungen/verein" className={linkBtn}>
                <Settings2 className="size-4" />
                Vereinsdaten pflegen
              </Link>
            </InfoBox>
          ) : org.data ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ihre Konfiguration
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <ConfigTile label="Mahnfrist" value={`${org.data.mahnFristTage} Tage`} />
                <ConfigTile label="Höchste Mahnstufe" value={String(org.data.maxMahnstufe)} />
                <ConfigTile
                  label="SEPA-Rückgebühr"
                  value={formatCurrency(org.data.sepaReturnFee) || EMPTY_VALUE}
                />
                <ConfigTile
                  label="Gebühr 1. Erinnerung"
                  value={formatCurrency(org.data.mahngebuhr1) || EMPTY_VALUE}
                />
                <ConfigTile
                  label="Gebühr 1. Mahnung"
                  value={formatCurrency(org.data.mahngebuhr2) || EMPTY_VALUE}
                />
                <ConfigTile
                  label="Gebühr 2. Mahnung"
                  value={formatCurrency(org.data.mahngebuhr3) || EMPTY_VALUE}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Diese Werte gelten für neue Mahnläufe. Anpassen unter{" "}
                <Link
                  to="/app/einstellungen/verein"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Vereinsdaten
                </Link>
                .
              </p>
            </div>
          ) : null}

          {canSeeDunning ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Offene Forderungen
              </h3>
              {open.data ? (
                open.data.totals.postings === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-success" />
                    Aktuell keine offenen Posten. Nichts zu mahnen.
                  </p>
                ) : (
                  <>
                    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <ConfigTile
                        label="Mitglieder mit Forderung"
                        value={String(open.data.totals.members)}
                      />
                      <ConfigTile label="Offene Posten" value={String(open.data.totals.postings)} />
                      <ConfigTile
                        label="Offene Summe"
                        value={formatCurrency(open.data.totals.openSum) || EMPTY_VALUE}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StufePill
                        label="Noch nicht gemahnt"
                        count={open.data.totals.byStufe[0] ?? 0}
                      />
                      <StufePill label="1. Erinnerung" count={open.data.totals.byStufe[1] ?? 0} />
                      <StufePill label="1. Mahnung" count={open.data.totals.byStufe[2] ?? 0} />
                      <StufePill label="2. Mahnung" count={open.data.totals.byStufe[3] ?? 0} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link to="/app/forderungen" className={linkBtn}>
                        <FileWarning className="size-4" />
                        Zu den Forderungen
                      </Link>
                      <Link to="/app/forderungen/mahnungen/neu" className={linkBtnPrimary}>
                        <Send className="size-4" />
                        Neuen Mahnlauf starten
                      </Link>
                    </div>
                  </>
                )
              ) : open.isError ? (
                <p className="text-sm text-muted-foreground">
                  Der aktuelle Forderungsstand konnte nicht geladen werden.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Wird geladen…</p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Lifecycle overview + table of contents in one. */}
      <section id="lebenszyklus" className="scroll-mt-24">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Der Ablauf im Überblick</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          Sechs Schritte, vom gebuchten Beitrag bis zum letzten kulanten Angebot. Tippen Sie einen
          Schritt an, um direkt zur Anleitung zu springen.
        </p>
        <ol className="flex flex-col gap-2">
          {LIFECYCLE.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-soft transition-colors hover:border-ring/60 hover:bg-muted/40"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
                  {s.step}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {s.icon}
                    {s.title}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{s.teaser}</span>
                </span>
                <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </a>
              {i < LIFECYCLE.length - 1 ? (
                <div className="ml-[27px] h-2 w-px bg-border" aria-hidden />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* 1. Beitragslauf */}
      <StepSection
        id="beitragslauf"
        step={1}
        icon={<Coins className="size-5" />}
        title="Beitragslauf: Sollstellungen erzeugen"
      >
        <p>
          Am Anfang steht der Beitragslauf. Er berechnet für ein Beitragsjahr die Posten
          (Sollstellungen) aller aktiven Verträge und erzeugt in einem Schritt die SEPA-Datei
          (pain.008) für den Bankupload.
        </p>
        <Steps
          items={[
            <>
              Öffnen Sie <Nav>Beitragsläufe</Nav> und klicken Sie auf <Ui>Neuer Lauf</Ui>.
            </>,
            <>
              <strong>Schritt 1 (Zeitraum):</strong> Beitragsjahr und Fälligkeitsdatum wählen, dann{" "}
              <Ui>Vorschau erstellen</Ui>.
            </>,
            <>
              <strong>Schritt 2 (Vorschau):</strong> prüfen, was abgebucht wird. Ausgeschlossene und
              eingeschlossene Mitglieder sind aufgelistet, optional mit Vorjahresvergleich.
            </>,
            <>
              <strong>Schritt 3 (Erzeugt):</strong> mit <Ui>Lauf erzeugen</Ui> festschreiben, dann{" "}
              <Ui>pain.008 herunterladen</Ui> und im Banking-Portal hochladen.
            </>,
            <>
              <strong>Schritt 4 (Bestätigt):</strong> erst nach erfolgreichem Bankupload im Lauf{" "}
              <Ui>Bankübermittlung bestätigen</Ui>. Danach gelten die Lastschriften als eingezogen.
            </>,
          ]}
        />
        <InfoBox title="Was dabei gebucht wird" tone="muted" icon={Info}>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong>Lastschriftzahler</strong> bleiben nach der Erzeugung zunächst ausstehend.
              Erst die ausdrückliche Bestätigung nach dem Bankupload setzt sie auf{" "}
              <Code>eingezogen</Code> und den offenen Betrag auf 0. Das verhindert, dass eine nur
              erzeugte, aber nie hochgeladene Datei als Zahlung zählt.
            </li>
            <li>
              <strong>Rechnungszahler</strong> bekommen eine <Code>offene</Code> Sollstellung ohne
              SEPA-Zeile. Sie erscheint sofort in den Forderungen und ist mahnbar, sobald sie
              überfällig ist.
            </li>
          </ul>
        </InfoBox>
        <p className="text-sm text-muted-foreground">
          Läufe sind additiv: Verträge mit bereits vorhandener Sollstellung für das Jahr werden
          übersprungen, ein Nachlauf ist also gefahrlos möglich. Ein erzeugter Lauf lässt sich
          stornieren, die zugehörigen Sollstellungen werden dann mitstorniert.
        </p>
        <Actions>
          <Link to="/app/beitrag" className={linkBtn}>
            <Coins className="size-4" />
            Beitragsläufe
          </Link>
          <Link to="/app/beitrag/neu" className={linkBtnPrimary}>
            Neuen Lauf starten
            <ArrowRight className="size-4" />
          </Link>
        </Actions>
      </StepSection>

      {/* 2. Zahlungen und SEPA */}
      <StepSection
        id="zahlungen"
        step={2}
        icon={<Banknote className="size-5" />}
        title="Zahlungen und SEPA"
      >
        <p>
          Nach der Erzeugung ist die Bankdatei noch nicht eingereicht. Laden Sie sie im
          Banking-Portal hoch und bestätigen Sie die Bankübermittlung im Lauf. Erst dann gelten die
          Lastschriften als eingezogen. Rechnungszahler überweisen selbst. Deren Posten markieren
          Sie als bezahlt, sobald das Geld da ist.
        </p>
        <Steps
          items={[
            <>
              Eingegangene Überweisungen gleichen Sie unter <Nav>Zahlungsabgleich</Nav> ab oder
              markieren die Posten in den <Nav>Forderungen</Nav> als bezahlt.
            </>,
            <>
              Einzelne Posten lassen sich auf der Mitgliederseite in der Karte <Ui>Sollstellung</Ui>{" "}
              von Hand auf <Code>offen</Code>, <Code>eingezogen</Code>, <Code>bezahlt</Code> oder{" "}
              <Code>storniert</Code> setzen. Offener und bezahlter Betrag werden passend
              nachgezogen, jede Änderung steht im Verlauf.
            </>,
          ]}
        />
        <InfoBox title="Was „offen“ genau heißt" tone="muted" icon={Info}>
          <p>
            Mahnbar ist ein Posten mit Status <Code>offen</Code> oder <Code>Rückläufer</Code> und
            einem offenen Betrag über null, bei einem nicht gelöschten und nicht mahngesperrten
            Mitglied. <Code>noch nicht übermittelt</Code>, <Code>eingezogen</Code>,{" "}
            <Code>bezahlt</Code> und <Code>storniert</Code> sind nie mahnbar.
          </p>
        </InfoBox>
        <Actions>
          <Link to="/app/forderungen" className={linkBtn}>
            <FileWarning className="size-4" />
            Forderungen
          </Link>
        </Actions>
      </StepSection>

      {/* 3. Rückläufer */}
      <StepSection
        id="ruecklaeufer"
        step={3}
        icon={<RotateCcw className="size-5" />}
        title="Rückläufer erfassen"
      >
        <p>
          Platzt eine Lastschrift (Rücklastschrift), buchen Sie den Rückläufer. Der Posten wird
          wieder offen gestellt, die Rückgebühr wird ergänzt und die Mahnstufe auf null
          zurückgesetzt. Danach taucht der Posten automatisch wieder in den Forderungen auf.
        </p>
        <Steps
          items={[
            <>
              Unter <Nav>SEPA-Rückläufer</Nav> einzelne Rückläufer erfassen oder eine camt.054-Datei
              der Bank importieren.
            </>,
            <>
              Soll der Betrag erneut eingezogen werden, nutzen Sie <Ui>Erneut einziehen</Ui>
              (Wiedereinzug). Das erzeugt eine neue pain.008 und stellt den Posten zurück auf
              eingezogen.
            </>,
          ]}
        />
        <Actions>
          <Link to="/app/forderungen/ruecklaeufer" className={linkBtn}>
            <RotateCcw className="size-4" />
            SEPA-Rückläufer
          </Link>
          <Link to="/app/beitrag/erneut-einziehen" className={linkBtn}>
            Erneut einziehen
            <ArrowRight className="size-4" />
          </Link>
        </Actions>
      </StepSection>

      {/* 4. Forderungen */}
      <StepSection
        id="forderungen"
        step={4}
        icon={<FileWarning className="size-5" />}
        title="Forderungen im Blick"
      >
        <p>
          Die Seite <Nav>Forderungen</Nav> ist die Zentrale für alles Offene. Sie listet alle
          offenen Sollstellungen je Mitglied, gefiltert nach Mahnstufe, samt Summen und
          SEPA-Rückläufern.
        </p>
        <Steps
          items={[
            <>
              Mit den Filter-Chips nach Mahnstufe eingrenzen: <em>Alle</em>,{" "}
              <em>Noch nicht gemahnt</em>, <em>1. Erinnerung</em>, <em>1. Mahnung</em>,{" "}
              <em>2. Mahnung</em>.
            </>,
            <>
              Hat ein Mitglied überwiesen, Posten anhaken und über <Ui>als bezahlt markieren</Ui>
              abschließen.
            </>,
            <>
              Für den nächsten Schritt oben rechts <Ui>Neue Mahnungen</Ui>, <Ui>Kulanz-Brief</Ui>
              oder <Ui>Rückläufer</Ui> wählen.
            </>,
          ]}
        />
        <Actions>
          <Link to="/app/forderungen" className={linkBtnPrimary}>
            <FileWarning className="size-4" />
            Forderungen öffnen
          </Link>
        </Actions>
      </StepSection>

      {/* 5. Mahnlauf */}
      <StepSection
        id="mahnlauf"
        step={5}
        icon={<Send className="size-5" />}
        title="Mahnlauf durchführen"
      >
        <p>
          Ein Mahnlauf erzeugt für eine Stufe die Schreiben aller fälligen Mitglieder als PDF und
          hebt anschließend deren Mahnstufe an. Die Stufen werden nacheinander durchlaufen: ein Lauf
          der Stufe N nimmt genau die Posten, die aktuell auf Stufe N-1 stehen.
        </p>
        <Steps
          items={[
            <>
              In den <Nav>Forderungen</Nav> auf <Ui>Neue Mahnungen</Ui> gehen (Seite{" "}
              <em>Neuer Mahnlauf</em>).
            </>,
            <>
              <strong>Stufe</strong> und <strong>Lauf-Datum</strong> wählen. Die Frist errechnet
              sich aus dem Lauf-Datum plus Mahnfrist. Die Vorschau aktualisiert sich sofort.
            </>,
            <>
              Empfänger prüfen: mahngesperrte Mitglieder werden übersprungen, Minderjährige an die
              gesetzliche Vertretung adressiert. Fehlt eine Anschrift oder Vertretung, weist ein
              Hinweis darauf hin.
            </>,
            <>
              Mit <Ui>Erstellen</Ui> den Lauf festschreiben. Für jedes Mitglied entsteht ein PDF,
              die Mahnstufe der Posten wird angehoben.
            </>,
            <>
              Auf der Laufseite jede Mahnung <Ui>als PDF</Ui> herunterladen, per <Ui>E-Mail</Ui>
              versenden (Vorschau vor dem Senden) oder <Ui>als per Brief versendet markieren</Ui>.
            </>,
          ]}
        />
        <InfoBox title="Reihenfolge und Storno" tone="muted" icon={Info}>
          <p className="mb-1">
            Erst Erinnerung, dann 1. Mahnung, dann 2. Mahnung. Zeigt eine Stufe keine Empfänger, ist
            zuerst die niedrigere Stufe fällig. Ein Lauf lässt sich stornieren; die Mahnstufe der
            betroffenen Posten wird dabei wieder um eine Stufe gesenkt.
          </p>
        </InfoBox>
        <InfoBox title="E-Mail-Versand braucht SMTP" tone="warning" icon={ShieldAlert}>
          <p>
            Der Versand per E-Mail setzt eine eingerichtete SMTP-Konfiguration und eine hinterlegte
            E-Mail-Adresse voraus. Ohne SMTP bleibt nur der Postweg (PDF herunterladen und als per
            Brief versendet markieren).
          </p>
        </InfoBox>
        <Actions>
          <Link to="/app/forderungen/mahnungen" className={linkBtn}>
            <Send className="size-4" />
            Mahnläufe
          </Link>
          <Link to="/app/forderungen/mahnungen/neu" className={linkBtnPrimary}>
            Neuen Mahnlauf starten
            <ArrowRight className="size-4" />
          </Link>
        </Actions>
      </StepSection>

      {/* 6. Kulanz */}
      <StepSection
        id="kulanz"
        step={6}
        icon={<HeartHandshake className="size-5" />}
        title="Kulanz-Brief"
      >
        <p>
          Der Kulanz-Brief ist ein Sammelschreiben für Mitglieder mit offenen Beiträgen, die Sie oft
          nur per Post erreichen. Es bietet zwei Wege: zahlen oder aus Kulanz die beigelegte
          Kündigungsbestätigung zurücksenden. Im zweiten Fall verzichtet der Verein auf die offene
          Forderung und beendet die Mitgliedschaft. Jedes Mitglied erhält ein eigenes Schreiben in
          einem gemeinsamen PDF.
        </p>
        <Steps
          items={[
            <>
              In den <Nav>Forderungen</Nav> auf <Ui>Kulanz-Brief</Ui> gehen.
            </>,
            <>
              Optionen wählen: <em>Nur Mitglieder ohne E-Mail</em> (Standard, Postweg),{" "}
              <em>SEPA-Gebühr erlassen</em>, <em>Unterschrift einbetten</em> und eine <em>Frist</em>{" "}
              für Zahlung oder Kündigung.
            </>,
            <>
              Empfänger prüfen (Hinweis „Anschrift fehlt“ beachten), dann{" "}
              <Ui>Sammelbrief erzeugen</Ui>. Das PDF wird erzeugt und gleich zum Download angeboten,
              frühere Sammelbriefe bleiben abrufbar.
            </>,
          ]}
        />
        <InfoBox
          title="Wichtig: es wird nichts automatisch verbucht"
          tone="warning"
          icon={TriangleAlert}
        >
          <p>
            Der Kulanz-Brief verändert keine Mahnstufen und bucht keine Posten. Geht die Zahlung
            oder die Kündigung ein, markieren Sie das wie gewohnt von Hand (Posten als bezahlt bzw.
            storniert). Er ignoriert die Mahnstufe und steht damit außerhalb der Mahnleiter, als
            letzter kulanter Schritt für alte, offene Forderungen.
          </p>
        </InfoBox>
        <Actions>
          <Link to="/app/forderungen/kulanz" className={linkBtnPrimary}>
            <HeartHandshake className="size-4" />
            Kulanz-Brief erstellen
          </Link>
        </Actions>
      </StepSection>

      {/* Mahnstufen im Detail */}
      <section id="stufen" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-5 text-muted-foreground" />
              Mahnstufen im Detail
            </CardTitle>
            <CardDescription>
              Die Bezeichnungen sind gegenüber der internen Zählung um eins versetzt. Maßgeblich ist
              der Titel auf dem PDF.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Stufe</th>
                    <th className="py-2 pr-4 font-medium">Bezeichnung</th>
                    <th className="py-2 pr-4 font-medium">Titel auf dem PDF</th>
                    <th className="py-2 font-medium">Gebühr (Standard)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <StufeRow
                    stufe="0"
                    label="Noch nicht gemahnt"
                    pdf={EMPTY_VALUE}
                    fee={EMPTY_VALUE}
                  />
                  <StufeRow
                    stufe="1"
                    label="1. Erinnerung"
                    pdf="Zahlungserinnerung"
                    fee={formatCurrency(org.data?.mahngebuhr1) || "0,00 €"}
                  />
                  <StufeRow
                    stufe="2"
                    label="1. Mahnung"
                    pdf="1. Mahnung"
                    fee={formatCurrency(org.data?.mahngebuhr2) || "5,00 €"}
                  />
                  <StufeRow
                    stufe="3"
                    label="2. Mahnung"
                    pdf="2. Mahnung"
                    fee={formatCurrency(org.data?.mahngebuhr3) || "10,00 €"}
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Stufe 1 (Zahlungserinnerung) ist bewusst freundlich und im Standard ohne Gebühr. Stufe
              3 ist die letzte Stufe vor weiteren Schritten. Die Höchststufe kann pro Verein auf 1
              oder 2 begrenzt werden.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Voraussetzungen und Fehlermeldungen */}
      <section id="voraussetzungen" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-muted-foreground" />
              Voraussetzungen und häufige Fehlermeldungen
            </CardTitle>
            <CardDescription>
              Was vorliegen muss und was einzelne Meldungen bedeuten.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Bevor ein Mahnlauf möglich ist</h3>
              <ul className="ml-4 flex list-disc flex-col gap-1.5 text-sm text-foreground/80">
                <li>
                  <strong>Vereinsdaten</strong> gepflegt (Bankverbindung, Gebühren, Fristen). Diese
                  liefern auch IBAN und Gläubiger-ID für das PDF.{" "}
                  <Link
                    to="/app/einstellungen/verein"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Vereinsdaten
                  </Link>
                </li>
                <li>
                  <strong>Offene Posten auf der Vorstufe</strong> vorhanden, erzeugt durch einen{" "}
                  <Link
                    to="/app/beitrag"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Beitragslauf
                  </Link>
                  .
                </li>
                <li>
                  Für den E-Mail-Versand: eingerichtete{" "}
                  {me.data?.role === "admin" ? (
                    <Link
                      to="/app/einstellungen/smtp"
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      SMTP-Konfiguration
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">SMTP-Konfiguration</span>
                  )}{" "}
                  und eine hinterlegte E-Mail-Adresse.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Meldungen, die Ihnen begegnen können</h3>
              <dl className="flex flex-col gap-2 text-sm">
                <Faq
                  q="„Vereinsdaten fehlen. Bitte unter Einstellungen pflegen.“"
                  a="Es sind noch keine Vereinsdaten hinterlegt. Der Mahnlauf braucht Bankverbindung, Gebühren und Fristen."
                />
                <Faq
                  q="„Für die nächste Stufe ist erst eine niedrigere Mahnung notwendig.“"
                  a="Auf der gewählten Stufe stehen keine Posten. Erst die vorherige Stufe laufen lassen. Ein Lauf der Stufe N nimmt nur Posten der Stufe N-1."
                />
                <Faq
                  q="„Keine versendbaren Mahnungen (alle Empfänger sind mahngesperrt oder ohne offene Beträge).“"
                  a="Alle Ausgewählten sind mahngesperrt oder haben keinen offenen Betrag. Mahnsperre steht auf der Mitgliederseite."
                />
                <Faq
                  q="„Diese Mahnungen wurden zwischenzeitlich bereits in einem anderen Lauf erzeugt.“"
                  a="Ein paralleler Lauf hat die Posten schon angehoben. Liste neu laden und erneut prüfen."
                />
                <Faq
                  q="„SMTP ist nicht konfiguriert. Bitte unter Einstellungen einrichten.“"
                  a="Der E-Mail-Versand ist nicht eingerichtet. Bis dahin PDF herunterladen und per Brief versenden."
                />
              </dl>
            </div>
            <InfoBox title="Status von Hand korrigieren" tone="muted" icon={UserCog}>
              <p>
                Einzelne Posten setzen Sie auf der Mitgliederseite in der Karte{" "}
                <Ui>Sollstellung</Ui> direkt auf den richtigen Status. Nützlich bei Sonderfällen,
                die der Automatik entgehen (Barzahlung, Erlass, Korrektur einer Fehlbuchung).
              </p>
            </InfoBox>
          </CardContent>
        </Card>
      </section>

      <div className="flex items-center justify-between border-t border-border pt-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Landmark className="size-4" />
          Weitere Kapitel folgen.
        </span>
        <a
          href="#lebenszyklus"
          className="font-medium text-foreground underline underline-offset-2"
        >
          Nach oben
        </a>
      </div>
    </div>
  );
}

function ConfigTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StufePill({ label, count }: { label: string; count: number }) {
  return (
    <Link
      to="/app/forderungen"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:border-ring/60 hover:bg-muted/40",
        count > 0 ? "border-border" : "border-border/60 text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </Link>
  );
}

function StepSection({
  id,
  step,
  icon,
  title,
  children,
}: {
  id: string;
  step: number;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-base font-semibold text-brand">
              {step}
            </span>
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className="text-muted-foreground">{icon}</span>
              {title}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm leading-relaxed text-foreground/85">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 marker:font-semibold marker:text-muted-foreground">
      {items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered, never reordered
        <li key={i} className="pl-1">
          {it}
        </li>
      ))}
    </ol>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>;
}

/** A UI label the user will look for on screen (button text, tab). */
function Ui({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">„{children}“</span>;
}

/** The name of a navigation entry. */
function Nav({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </code>
  );
}

function StufeRow({
  stufe,
  label,
  pdf,
  fee,
}: {
  stufe: string;
  label: string;
  pdf: string;
  fee: string;
}) {
  return (
    <tr>
      <td className="py-2 pr-4">
        <Badge variant="secondary">{stufe}</Badge>
      </td>
      <td className="py-2 pr-4 font-medium">{label}</td>
      <td className="py-2 pr-4 text-muted-foreground">{pdf}</td>
      <td className="py-2 tabular-nums text-muted-foreground">{fee}</td>
    </tr>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <dt className="flex items-start gap-2 font-medium">
        <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {q}
      </dt>
      <dd className="mt-1 pl-6 text-muted-foreground">{a}</dd>
    </div>
  );
}
