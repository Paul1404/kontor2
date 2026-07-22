import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox, KeyRound, Pencil, ShieldCheck } from "lucide-react";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { SkeletonText } from "~/components/ui/skeleton";
import { cn } from "~/lib/cn";
import { EMPTY_VALUE, formatDate, formatPhone } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/portal/")({
  component: PortalHome,
});

function PortalHome() {
  const me = useQuery({
    queryKey: ["portal.me"],
    queryFn: () => orpc.portal.me(),
    retry: false,
  });

  if (me.isLoading) {
    return <SkeletonText lines={5} className="max-w-md" />;
  }
  if (me.isError) {
    return <QueryError error={me.error} onRetry={() => me.refetch()} />;
  }
  if (!me.data?.member) {
    return <NotSignedIn />;
  }

  const m = me.data.member;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Hallo {[m.vorname, m.nachname].filter(Boolean).join(" ") || "Mitglied"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hier können Sie Ihre persönlichen Daten einsehen und Änderungen vorschlagen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ihre Mitgliedschaft</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Detail label={m.memberNo ? "Mitgliedsnummer" : "Kontaktnummer"} value={memberRef(m)} />
            <Detail label="Eintritt" value={m.eintritt ? formatDate(m.eintritt) : "—"} />
            <Detail
              label="Geburtsdatum"
              value={m.geburtsdatum ? formatDate(m.geburtsdatum) : "—"}
            />
            <Detail label="Status" value={m.austritt ? "Ausgetreten" : "Aktiv"} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kontaktdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Detail label="Anrede" value={m.anrede} />
            <Detail label="Vorname" value={m.vorname} />
            <Detail label="Nachname" value={m.nachname} />
            <Detail label="E-Mail" value={m.email} />
            <Detail
              label="Anschrift"
              value={
                [
                  [m.strasse, m.hausnummer].filter(Boolean).join(" "),
                  [m.plz, m.ort].filter(Boolean).join(" "),
                ]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
            <Detail label="Land" value={m.land ?? "Deutschland"} />
            <Detail label="Telefon" value={formatPhone(m.telefon1)} />
            <Detail label="Telefon mobil" value={formatPhone(m.telefon2)} />
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-accent/40 p-4">
        <div className="flex items-center gap-3 text-sm">
          <ShieldCheck className="size-5 text-success" />
          <div>
            <p className="font-medium">Daten ändern</p>
            <p className="text-xs text-muted-foreground">
              Änderungen werden vom Vorstand geprüft und übernommen.
            </p>
          </div>
        </div>
        <Link to="/portal/profil" className={cn(buttonVariants())}>
          <Pencil className="size-4" /> Daten bearbeiten
        </Link>
      </div>

      {me.data.pendingCount > 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <Inbox className="mr-1.5 inline-block size-4 align-text-bottom text-warning" />
          Sie haben <strong>{me.data.pendingCount}</strong> noch nicht geprüfte Änderungsvorschläge
          in Bearbeitung.
        </p>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5">{value == null || value === "" ? EMPTY_VALUE : value}</dd>
    </div>
  );
}

function NotSignedIn() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <KeyRound className="mx-auto size-10 text-muted-foreground" />
      <h1 className="mt-4 text-xl font-semibold">Zugang erforderlich</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sie haben keinen gültigen Zugang zum Mitgliederportal. Bitte verwenden Sie den
        Einladungslink, den der Verein Ihnen per E-Mail zugesendet hat. Falls Sie keinen Link
        erhalten haben, wenden Sie sich bitte an die Geschäftsstelle.
      </p>
    </div>
  );
}
