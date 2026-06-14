import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, MailCheck, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { FilterChip } from "~/components/ui/filter-chip";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { formatDateTime } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/portal-anfragen")({
  component: PortalRequestsPage,
});

type Status = "pending" | "applied" | "rejected" | "partial";

const FIELD_LABELS: Record<string, string> = {
  anrede: "Anrede",
  vorname: "Vorname",
  nachname: "Nachname",
  strasse: "Straße",
  hausnummer: "Hausnummer",
  plz: "PLZ",
  ort: "Ort",
  land: "Land",
  telefon1: "Telefon",
  telefon2: "Mobil",
  email: "E-Mail",
};

function PortalRequestsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status | "">("pending");

  const list = useQuery({
    queryKey: ["portal.listRequests", statusFilter],
    queryFn: () =>
      orpc.portal.listRequests({
        status: statusFilter || null,
        page: 1,
        pageSize: 200,
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Portal-Anfragen</h1>
          <p className="text-sm text-muted-foreground">
            Datenänderungen, die Mitglieder über das Selbstbedienungsportal vorgeschlagen haben.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <FilterChip
            label="Offen"
            active={statusFilter === "pending"}
            onClick={() => setStatusFilter("pending")}
          />
          <FilterChip
            label="Übernommen"
            active={statusFilter === "applied"}
            onClick={() => setStatusFilter("applied")}
          />
          <FilterChip
            label="Teilweise"
            active={statusFilter === "partial"}
            onClick={() => setStatusFilter("partial")}
          />
          <FilterChip
            label="Abgelehnt"
            active={statusFilter === "rejected"}
            onClick={() => setStatusFilter("rejected")}
          />
          <FilterChip
            label="Alle"
            active={statusFilter === ""}
            onClick={() => setStatusFilter("")}
          />
        </div>
      </div>

      <InfoBox title="So funktioniert es" collapsible defaultOpen={false}>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            Mitglieder melden sich im Selbstbedienungsportal an und schlagen Änderungen ihrer Stamm-
            oder Kontaktdaten vor. Die Daten werden nicht direkt übernommen.
          </li>
          <li>
            Jede offene Anfrage erscheint hier. Pro Feld sehen Sie den alten und den neuen Wert
            nebeneinander.
          </li>
          <li>
            Per Häkchen entscheiden Sie pro Feld, was übernommen wird. Nicht angehakte Felder
            bleiben unverändert. Status wird automatisch <em>übernommen</em>, <em>teilweise</em>{" "}
            oder <em>abgelehnt</em>.
          </li>
          <li>
            Eine Notiz wird intern gespeichert und im Audit-Log abgelegt. Das Mitglied sieht sie
            nicht direkt, sie hilft aber bei Rückfragen.
          </li>
          <li>
            Bearbeitete Anfragen bleiben in der Historie. Bei Bedarf kann der Mitgliederstand über{" "}
            <em>Snapshots</em> rückwirkend wiederhergestellt werden.
          </li>
        </ol>
      </InfoBox>

      <Card>
        <CardHeader>
          <CardTitle>{list.data ? `${list.data.total} Anfrage(n)` : "Anfragen"}</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Wird geladen…</p>
          ) : list.isError ? (
            <QueryError onRetry={() => list.refetch()} />
          ) : !list.data || list.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Anfragen für diesen Filter.</p>
          ) : (
            <ul className="divide-y">
              {list.data.rows.map((r) => (
                <RequestRow
                  key={r.id}
                  row={r}
                  onAction={() => qc.invalidateQueries({ queryKey: ["portal.listRequests"] })}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Row = NonNullable<Awaited<ReturnType<typeof orpc.portal.listRequests>>["rows"][number]>;

function RequestRow({ row, onAction }: { row: Row; onAction: () => void }) {
  const payload = (row.payload as Record<string, { before: unknown; after: unknown }>) ?? {};
  const fields = Object.keys(payload);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(fields));
  const [notes, setNotes] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);

  const review = useMutation({
    mutationFn: (mode: "apply" | "reject") =>
      orpc.portal.reviewRequest({
        id: row.id,
        applyFields: mode === "apply" ? ([...picked] as never) : ([] as never),
        rejectNotes: notes.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(
        r.status === "applied"
          ? "Alle Änderungen übernommen."
          : r.status === "partial"
            ? "Ausgewählte Änderungen übernommen."
            : "Anfrage abgelehnt.",
      );
      onAction();
    },
    onError: (e: Error) =>
      toast.error("Konnte nicht bearbeitet werden", { description: e.message }),
  });

  function togglePick(f: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  const memberName =
    [row.vorname, row.nachname].filter(Boolean).join(" ") ||
    row.kurzname ||
    row.firma1 ||
    `AdrNr ${row.adrNr}`;
  const isPending = row.status === "pending";

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/app/mitglieder/$mitgliedsnummer"
              params={{ mitgliedsnummer: memberRef(row) }}
              className="font-medium hover:underline"
            >
              {memberName}
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums">#{memberRef(row)}</span>
            <StatusBadge status={row.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            eingereicht {formatDateTime(row.submittedAt)}
            {row.submittedIp ? <> · IP {row.submittedIp}</> : null}
          </p>
          {row.reviewerNotes ? (
            <p className="text-xs text-muted-foreground italic">{row.reviewerNotes}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-lg border">
        <ul className="divide-y">
          {fields.map((f) => {
            const change = payload[f];
            return (
              <li key={f} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                {isPending ? (
                  <input
                    type="checkbox"
                    checked={picked.has(f)}
                    onChange={() => togglePick(f)}
                    className="size-4 rounded border-input"
                    aria-label={`Feld ${FIELD_LABELS[f] ?? f} übernehmen`}
                  />
                ) : null}
                <span className="min-w-32 font-medium">{FIELD_LABELS[f] ?? f}</span>
                <span className="text-xs text-muted-foreground">
                  {valueToString(change?.before)} →{" "}
                  <strong className="text-foreground">{valueToString(change?.after)}</strong>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {isPending ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-64">
            <label className="text-xs text-muted-foreground" htmlFor={`notes-${row.id}`}>
              Notiz an Mitglied (optional, intern)
            </label>
            <Input
              id={`notes-${row.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button
            disabled={picked.size === 0 || review.isPending}
            onClick={() => review.mutate("apply")}
          >
            <Check className="size-4" />{" "}
            {picked.size === fields.length ? "Alle übernehmen" : `Übernehmen (${picked.size})`}
          </Button>
          <Button
            variant="outline"
            disabled={review.isPending}
            onClick={() => setConfirmReject(true)}
          >
            <X className="size-4" /> Ablehnen
          </Button>
          <ConfirmDialog
            open={confirmReject}
            onOpenChange={setConfirmReject}
            title="Anfrage ablehnen?"
            description="Die vorgeschlagenen Änderungen werden verworfen und nicht übernommen."
            confirmLabel="Ablehnen"
            destructive
            loading={review.isPending}
            onConfirm={() => {
              review.mutate("reject");
              setConfirmReject(false);
            }}
          />
        </div>
      ) : (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MailCheck className="size-3" />
          {row.reviewedAt ? <>bearbeitet {formatDateTime(row.reviewedAt)}</> : null}
        </p>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge variant="warning">offen</Badge>;
  if (status === "applied") return <Badge variant="success">übernommen</Badge>;
  if (status === "partial") return <Badge variant="info">teilweise</Badge>;
  return <Badge variant="destructive">abgelehnt</Badge>;
}

function valueToString(v: unknown): string {
  if (v == null || v === "") return "leer";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
