import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Loader2, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AbteilungenCard } from "~/components/forms/AbteilungenCard";
import { AttachmentsCard } from "~/components/forms/AttachmentsCard";
import { BeziehungenCard } from "~/components/forms/BeziehungenCard";
import { ContractsCard } from "~/components/forms/ContractsCard";
import { SepaCard } from "~/components/forms/SepaCard";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  actionLabel,
  fieldLabel,
  formatAuditValue,
  isHiddenField,
} from "~/lib/audit-labels";
import { formatLand } from "~/lib/country";
import { formatDate, formatDateTime } from "~/lib/format";
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

  // Pull the IBAN before the early-return so the hook is called in the
  // same order on every render (rules-of-hooks).
  const memberIban = ((detail.data?.member as Record<string, unknown> | undefined)?.iban1 ??
    null) as string | null;
  const ibanInfo = useIbanBank(memberIban);

  if (detail.isLoading) return <p className="text-muted-foreground">Wird geladen...</p>;
  if (detail.isError || !detail.data) {
    return <p className="text-destructive">Mitglied nicht gefunden.</p>;
  }

  const { member, abteilungen, vertraege, sepa, anhaenge, audit, beziehungen } = detail.data;
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";

  // Prefer the IBAN-derived bank name/BIC over the stored values — those
  // were free-text in Linear and don't always match the actual BLZ.
  const bankDisplay = ibanInfo?.name ?? member.bank1;
  const bicDisplay = ibanInfo?.bic ?? member.bic1;

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
            <Field
              label="Adresse"
              value={`${member.strasse ?? ""} ${member.hausnummer ?? ""}\n${member.plz ?? ""} ${member.ort ?? ""}`.trim()}
            />
            <Field label="Land" value={formatLand(member.land)} />
            <Field label="Telefon" value={member.telefon1} />
            <Field label="Mobil" value={member.telefon2} />
            <Field label="E-Mail" value={member.eMailName} />
            <Field label="Eintritt" value={formatDate(member.eintritt)} />
            <Field label="Austritt" value={formatDate(member.austritt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bankverbindung</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Field label="IBAN" value={formatIbanGrouped(member.iban1)} mono />
            <Field label="Bank" value={bankDisplay} />
            <Field label="BIC" value={bicDisplay} mono />
            <Field label="Kontoinhaber" value={member.abwKontoInh} />
            {ibanInfo ? (
              <p className="text-xs text-muted-foreground">
                Bank und BIC werden aus der IBAN abgeleitet (Quelle: Bundesbank BLZ-Verzeichnis).
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {member.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notizen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-foreground">{member.notes}</p>
          </CardContent>
        </Card>
      ) : null}

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

      <AttachmentsCard
        memberId={member.id}
        mitgliedsnummer={mitgliedsnummer}
        anhaenge={anhaenge}
        canEdit={canEdit}
      />

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
                <AuditEntry key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function useIbanBank(iban: string | null | undefined): { name: string; bic: string } | null {
  const cleaned = useMemo(() => (iban ? iban.replace(/\s+/g, "").toUpperCase() : ""), [iban]);
  const enabled = cleaned.length >= 12 && cleaned.startsWith("DE");
  const query = useQuery({
    queryKey: ["banks.lookupByIban", cleaned],
    queryFn: () => orpc.banks.lookupByIban({ iban: cleaned }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (!query.data?.found) return null;
  return { name: query.data.name, bic: query.data.bic };
}

function formatIbanGrouped(iban: string | null | undefined): string {
  if (!iban) return "";
  return iban
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function Field({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase text-muted-foreground tracking-wide">{label}</span>
      <span className={`whitespace-pre-line ${mono ? "font-mono tabular-nums" : ""}`}>
        {value == null || value === "" ? (
          <span className="text-muted-foreground">k.A.</span>
        ) : (
          String(value)
        )}
      </span>
    </div>
  );
}

type AuditEntryRow = {
  id: string;
  action: string;
  source: string;
  actorEmail: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string | Date;
};

function AuditEntry({ entry }: { entry: AuditEntryRow }) {
  const [open, setOpen] = useState(false);
  const visibleChanges = Object.entries(entry.changes ?? {}).filter(([k]) => !isHiddenField(k));
  const summary = visibleChanges
    .slice(0, 3)
    .map(([k]) => fieldLabel(k))
    .join(", ");
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left hover:bg-muted/30 -mx-2 px-2 py-1 rounded"
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{actionLabel(entry.action)}</Badge>
            <span className="text-sm">
              {visibleChanges.length === 0
                ? "Keine sichtbaren Felder geändert"
                : `${visibleChanges.length} Feld${visibleChanges.length === 1 ? "" : "er"}: ${summary}${visibleChanges.length > 3 ? "…" : ""}`}
            </span>
          </div>
          {entry.actorEmail ? (
            <span className="text-xs text-muted-foreground">{entry.actorEmail}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(entry.createdAt)}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && visibleChanges.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded border border-border bg-muted/30">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Feld</th>
                <th className="px-3 py-1.5 font-medium">Vorher</th>
                <th className="px-3 py-1.5 font-medium">Nachher</th>
              </tr>
            </thead>
            <tbody>
              {visibleChanges.map(([k, change]) => (
                <tr key={k} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-medium">{fieldLabel(k)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatAuditValue(k, change.before)}
                  </td>
                  <td className="px-3 py-1.5">{formatAuditValue(k, change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}
