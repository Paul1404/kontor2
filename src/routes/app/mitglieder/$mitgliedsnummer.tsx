import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { AbteilungenCard } from "~/components/forms/AbteilungenCard";
import { BeziehungenCard } from "~/components/forms/BeziehungenCard";
import { ContractsCard } from "~/components/forms/ContractsCard";
import { SepaCard } from "~/components/forms/SepaCard";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDate, formatDateTime, formatIbanMask } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/mitglieder/$mitgliedsnummer")({
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const { mitgliedsnummer } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const detail = useQuery({
    queryKey: ["members.get", mitgliedsnummer],
    queryFn: () => orpc.members.get({ mitgliedsnummer }),
  });

  const softDelete = useMutation({
    mutationFn: (memberId: string) => orpc.members.softDelete({ memberId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["members.list"] });
      navigate({ to: "/app/mitglieder" });
    },
  });

  if (detail.isLoading) return <p className="text-muted-foreground">Wird geladen...</p>;
  if (detail.isError || !detail.data) {
    return <p className="text-destructive">Mitglied nicht gefunden.</p>;
  }

  const { member, abteilungen, vertraege, sepa, anhaenge, audit, beziehungen } = detail.data;
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
            Mitgliedsnummer: <span className="tabular-nums">{member.mitglnr}</span> · AdrNr{" "}
            {member.adrNr}
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Link to="/app/mitglieder/$mitgliedsnummer/bearbeiten" params={{ mitgliedsnummer }}>
              <Button variant="outline" size="sm">
                <Pencil className="size-4" /> Bearbeiten
              </Button>
            </Link>
            {confirmDelete ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => softDelete.mutate(member.id)}
                  disabled={softDelete.isPending}
                >
                  {softDelete.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Wirklich löschen
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={softDelete.isPending}
                >
                  Abbrechen
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4 text-destructive" /> Löschen
              </Button>
            )}
          </div>
        ) : null}
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

      <AbteilungenCard
        memberId={member.id}
        mitgliedsnummer={mitgliedsnummer}
        abteilungen={abteilungen as never}
        canEdit={canEdit}
      />

      <BeziehungenCard
        memberId={member.id}
        mitgliedsnummer={mitgliedsnummer}
        beziehungen={beziehungen as never}
        canEdit={canEdit}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ContractsCard
          memberId={member.id}
          mitgliedsnummer={mitgliedsnummer}
          vertraege={vertraege as never}
          canEdit={canEdit}
        />
        <SepaCard
          memberId={member.id}
          mitgliedsnummer={mitgliedsnummer}
          mandate={sepa as never}
          canEdit={canEdit}
        />
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
        {value == null || value === "" ? (
          <span className="text-muted-foreground">k.A.</span>
        ) : (
          String(value)
        )}
      </span>
    </div>
  );
}
