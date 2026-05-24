import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatCurrency, formatDate, formatDateTime, formatIbanMask } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/mitglieder/$mitgliedsnummer")({
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const { mitgliedsnummer } = Route.useParams();
  const detail = useQuery({
    queryKey: ["members.get", mitgliedsnummer],
    queryFn: () => orpc.members.get({ mitgliedsnummer }),
  });

  if (detail.isLoading) return <p className="text-muted-foreground">Wird geladen...</p>;
  if (detail.isError || !detail.data) {
    return <p className="text-destructive">Mitglied nicht gefunden.</p>;
  }

  const { member, abteilungen, vertraege, sepa, anhaenge, audit } = detail.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/app/mitglieder"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Zurück zur Liste
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {[member.titel1, member.vorname, member.nachname].filter(Boolean).join(" ")}
          </h1>
          <p className="text-sm text-muted-foreground">
            Mitgliedsnummer: <span className="tabular-nums">{member.mitglnr}</span> · AdrNr {member.adrNr}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stammdaten</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Anrede" value={member.anrede} />
            <Field label="Geburtsdatum" value={formatDate(member.geburtsdatum)} />
            <Field label="Geburtsort" value={member.geburtsort} />
            <Field label="Geburtsname" value={member.geborene ?? member.geburtsname} />
            <Field
              label="Adresse"
              value={`${member.strasse ?? ""} ${member.hausnummer ?? ""}\n${member.plz ?? ""} ${member.ort ?? ""}`.trim()}
            />
            <Field label="Land" value={member.land} />
            <Field label="Telefon" value={member.telefon1} />
            <Field label="Mobil" value={member.telefon2} />
            <Field label="E-Mail" value={member.eMailName} />
            <Field label="Eintritt" value={formatDate(member.eintritt)} />
            <Field label="Austritt" value={formatDate(member.austritt)} />
            <Field label="Verstorben" value={formatDate(member.verstorbenAm)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bankverbindung</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Field label="Bank" value={member.bank1} />
            <Field label="IBAN" value={formatIbanMask(member.iban1Last4)} />
            <Field label="BIC" value={member.bic1} />
            <Field label="Mandatsreferenz" value={member.mandatsrefenz} />
            <Field label="Kontoinhaber" value={member.abwKontoInh} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Abteilungen</CardTitle>
        </CardHeader>
        <CardContent>
          {abteilungen.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Abteilungszuordnung.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {abteilungen.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{a.name}</span>
                  <span className="text-muted-foreground">
                    Eintritt {formatDate(a.eintrittsdatum)}
                    {a.austrittsdatum ? ` · Austritt ${formatDate(a.austrittsdatum)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Verträge</CardTitle>
          </CardHeader>
          <CardContent>
            {vertraege.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Verträge.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1">Vertrag</th>
                    <th className="py-1">Art</th>
                    <th className="py-1 text-right">Betrag</th>
                    <th className="py-1">Beginn</th>
                  </tr>
                </thead>
                <tbody>
                  {vertraege.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="py-1 tabular-nums">{v.vertragNr}</td>
                      <td className="py-1">{v.artName ?? v.art}</td>
                      <td className="py-1 text-right tabular-nums">{formatCurrency(v.betrag)}</td>
                      <td className="py-1 text-muted-foreground">{formatDate(v.vertragBegin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SEPA-Mandate</CardTitle>
          </CardHeader>
          <CardContent>
            {sepa.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Mandate.</p>
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {sepa.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <span className="tabular-nums">{s.mandatsNr}</span>
                    <span className="text-muted-foreground">
                      <Badge variant="outline">{s.status ?? "?"}</Badge> · {formatDate(s.gueltigAb)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Anhänge</CardTitle>
        </CardHeader>
        <CardContent>
          {anhaenge.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Anhänge.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {anhaenge.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <a href={`/api/files/${a.id}`} className="text-primary hover:underline">
                    {a.filename}
                  </a>
                  <span className="text-muted-foreground">
                    {(a.sizeBytes / 1024).toFixed(0)} KB · {formatDate(a.uploadedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Änderungen protokolliert.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {audit.map((entry) => (
                <li key={entry.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      <Badge variant="outline" className="mr-2">
                        {entry.action}
                      </Badge>
                      <span className="text-muted-foreground">{entry.source}</span>
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  {entry.actorEmail ? (
                    <p className="text-xs text-muted-foreground">{entry.actorEmail}</p>
                  ) : null}
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">
                    {Object.keys(entry.changes ?? {}).join(", ")}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase text-muted-foreground tracking-wide">{label}</span>
      <span className="whitespace-pre-line">
        {value == null || value === "" ? <span className="text-muted-foreground">k.A.</span> : String(value)}
      </span>
    </div>
  );
}
