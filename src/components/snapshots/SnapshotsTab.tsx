import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronDown, History, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/ui/toaster";
import { fieldLabel, formatAuditValue, isHiddenField } from "~/lib/audit-labels";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type SnapshotMeta = {
  id: string;
  createdAt: string | Date;
  trigger: "mutation" | "nightly" | "manual" | "pre_restore" | "pre_import";
  actorEmail: string | null;
  byteSize: number;
  contentHash: string;
  auditId: string | null;
  runId: string | null;
  notes: string | null;
};

const TRIGGER_LABELS: Record<SnapshotMeta["trigger"], { label: string; tone: string }> = {
  mutation: { label: "Änderung", tone: "secondary" },
  nightly: { label: "Nächtlich", tone: "outline" },
  manual: { label: "Manuell", tone: "default" },
  pre_restore: { label: "Vor Restore", tone: "warning" },
  pre_import: { label: "Vor Import", tone: "warning" },
};

export function SnapshotsTab({
  memberId,
  mitgliedsnummer,
  canRestore,
}: {
  memberId: string;
  mitgliedsnummer: string;
  canRestore: boolean;
}) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["snapshots.listForMember", memberId],
    queryFn: () => orpc.snapshots.listForMember({ memberId, limit: 50, cursor: null }),
  });

  const takeManual = useMutation({
    mutationFn: () => orpc.snapshots.takeManual({ memberId, notes: null }),
    onSuccess: async (result) => {
      if ("snapshotId" in result) {
        toast.success("Snapshot angelegt");
      }
      await qc.invalidateQueries({ queryKey: ["snapshots.listForMember", memberId] });
    },
    onError: (err) => toast.error("Snapshot fehlgeschlagen", { description: messageOf(err) }),
  });

  if (list.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Versionen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Wird geladen…</p>
        </CardContent>
      </Card>
    );
  }

  const rows = (list.data?.rows ?? []) as SnapshotMeta[];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            Versionen
          </CardTitle>
          <CardDescription>
            Vollständige Schnappschüsse vor jeder Änderung plus täglicher Backup-Lauf.
            Wiederherstellung ist selbst rückgängig machbar.
          </CardDescription>
        </div>
        {canRestore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => takeManual.mutate()}
            disabled={takeManual.isPending}
          >
            {takeManual.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Camera className="size-4" />
            )}
            Snapshot jetzt anlegen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Versionen vorhanden. Die erste Änderung an diesem Mitglied legt automatisch
            einen Snapshot an.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((row) => (
              <SnapshotRow
                key={row.id}
                meta={row}
                memberId={memberId}
                mitgliedsnummer={mitgliedsnummer}
                canRestore={canRestore}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type SnapshotDetail = {
  snapshot: {
    id: string;
    memberId: string;
    createdAt: string | Date;
    trigger: SnapshotMeta["trigger"];
    actorEmail: string | null;
    notes: string | null;
    byteSize: number;
    contentHash: string;
    runId: string | null;
    member: Record<string, unknown>;
    contracts: Record<string, unknown>[];
    sepa: Record<string, unknown>[];
    attachments: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    memberAbteilungen: Record<string, unknown>[];
    sollstellungen: Record<string, unknown>[];
  };
  diffVsCurrent: {
    member: Record<string, { before: unknown; after: unknown }>;
    contracts: { added: number; removed: number; changedIds: string[] };
    sepa: { added: number; removed: number; changedIds: string[] };
    attachments: { added: number; removed: number };
    relationships: { added: number; removed: number; changedIds: string[] };
    memberAbteilungen: { added: number; removed: number };
    sollstellungen: { added: number; removed: number; changedIds: string[] };
  } | null;
  memberDeleted: boolean;
};

function SnapshotRow({
  meta,
  memberId,
  mitgliedsnummer,
  canRestore,
}: {
  meta: SnapshotMeta;
  memberId: string;
  mitgliedsnummer: string;
  canRestore: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["snapshots.get", meta.id],
    queryFn: () => orpc.snapshots.get({ snapshotId: meta.id }),
    enabled: open && canRestore,
  });
  const tone = TRIGGER_LABELS[meta.trigger];

  return (
    <li className="py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="-mx-2 flex w-full items-start justify-between gap-3 rounded px-2 py-1 text-left hover:bg-muted/30"
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Badge variant={tone.tone as never}>{tone.label}</Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(meta.createdAt)}
            </span>
            <span className="text-xs text-muted-foreground">{formatBytes(meta.byteSize)}</span>
          </div>
          {meta.actorEmail ? (
            <span className="text-xs text-muted-foreground">{meta.actorEmail}</span>
          ) : null}
          {meta.notes ? <span className="text-xs">{meta.notes}</span> : null}
        </div>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <SnapshotDetailView
          meta={meta}
          memberId={memberId}
          mitgliedsnummer={mitgliedsnummer}
          detail={detail.data as SnapshotDetail | undefined}
          loading={detail.isLoading}
          error={detail.error}
          canRestore={canRestore}
        />
      ) : null}
    </li>
  );
}

function SnapshotDetailView({
  meta,
  memberId,
  mitgliedsnummer,
  detail,
  loading,
  error,
  canRestore,
}: {
  meta: SnapshotMeta;
  memberId: string;
  mitgliedsnummer: string;
  detail: SnapshotDetail | undefined;
  loading: boolean;
  error: unknown;
  canRestore: boolean;
}) {
  const qc = useQueryClient();
  const [confirmWhole, setConfirmWhole] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [confirmField, setConfirmField] = useState<string | null>(null);

  const restoreMember = useMutation({
    mutationFn: (opts: { snapshotId: string; includeDependents: boolean }) =>
      orpc.snapshots.restoreMember({
        snapshotId: opts.snapshotId,
        includeDependents: opts.includeDependents,
        dryRun: false,
      }),
    onSuccess: async () => {
      toast.success("Mitglied wiederhergestellt");
      setConfirmWhole(false);
      await qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });
      await qc.invalidateQueries({ queryKey: ["snapshots.listForMember", memberId] });
      await qc.invalidateQueries({ queryKey: ["members.list"] });
    },
    onError: (err) =>
      toast.error("Wiederherstellung fehlgeschlagen", { description: messageOf(err) }),
  });

  const restoreField = useMutation({
    mutationFn: (opts: { fieldName: string }) =>
      orpc.snapshots.restoreField({
        memberId,
        snapshotId: meta.id,
        fieldName: opts.fieldName,
        dryRun: false,
      }),
    onSuccess: async () => {
      toast.success("Feld wiederhergestellt");
      setConfirmField(null);
      await qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });
      await qc.invalidateQueries({ queryKey: ["snapshots.listForMember", memberId] });
    },
    onError: (err) =>
      toast.error("Wiederherstellung fehlgeschlagen", { description: messageOf(err) }),
  });

  if (loading) {
    return <div className="mt-2 px-2 py-3 text-xs text-muted-foreground">Wird geladen…</div>;
  }
  if (error) {
    return (
      <div className="mt-2 px-2 py-3 text-xs text-destructive">
        Snapshot konnte nicht geladen werden: {messageOf(error)}
      </div>
    );
  }
  if (!detail) {
    return canRestore ? null : (
      <div className="mt-2 px-2 py-3 text-xs text-muted-foreground">
        Snapshot-Inhalte sind für die Rolle „readonly“ ausgeblendet.
      </div>
    );
  }

  const visibleChanges = Object.entries(detail.diffVsCurrent?.member ?? {}).filter(
    ([k]) => !isHiddenField(k) && k !== "__meta",
  );
  const depTotals = detail.diffVsCurrent
    ? sumDepChanges(detail.diffVsCurrent)
    : { added: 0, removed: 0, changed: 0 };

  return (
    <div className="mt-2 flex flex-col gap-3 rounded border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Unterschiede zum aktuellen Stand:{" "}
          <span className="font-medium text-foreground">{visibleChanges.length}</span> Feld
          {visibleChanges.length === 1 ? "" : "er"}
          {depTotals.added + depTotals.removed + depTotals.changed > 0 ? (
            <>
              {" "}
              · {depTotals.added} hinzugefügt, {depTotals.removed} entfernt, {depTotals.changed}{" "}
              geändert in abhängigen Tabellen
            </>
          ) : null}
        </div>
        {canRestore ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmWhole(true)}>
            <RotateCcw className="size-4" /> Gesamtes Mitglied wiederherstellen
          </Button>
        ) : null}
      </div>

      {visibleChanges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Snapshot und aktueller Stand sind identisch.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Feld</th>
                <th className="px-3 py-1.5 font-medium">Snapshot</th>
                <th className="px-3 py-1.5 font-medium">Aktuell</th>
                {canRestore ? <th className="px-3 py-1.5 font-medium" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleChanges.map(([field, change]) => (
                <tr key={field}>
                  <td className="px-3 py-1.5 font-medium">{fieldLabel(field)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatAuditValue(field, change.before)}
                  </td>
                  <td className="px-3 py-1.5">{formatAuditValue(field, change.after)}</td>
                  {canRestore ? (
                    <td className="px-3 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmField(field)}
                      >
                        <RotateCcw className="size-3" /> Zurücksetzen
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmWhole}
        onOpenChange={(o) => {
          if (!restoreMember.isPending) setConfirmWhole(o);
        }}
        title="Mitglied wiederherstellen"
        description={`Setzt das gesamte Mitglied auf den Stand von ${formatDateTime(meta.createdAt)} zurück. Vor der Änderung wird ein zusätzlicher Snapshot angelegt, damit die Wiederherstellung selbst rückgängig gemacht werden kann.`}
        confirmLabel={`${visibleChanges.length} Feld${visibleChanges.length === 1 ? "" : "er"} zurücksetzen`}
        destructive
        loading={restoreMember.isPending}
        onConfirm={() => restoreMember.mutate({ snapshotId: meta.id, includeDependents })}
      >
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeDependents}
              onChange={(e) => setIncludeDependents(e.target.checked)}
              className="rounded border-border"
            />
            Abhängige Datensätze einbeziehen (Verträge, SEPA-Mandate, Beziehungen, Abteilungen)
          </label>
          {includeDependents ? (
            <p className="text-xs text-muted-foreground">
              Achtung: Bestehende Verträge, SEPA-Mandate, Beziehungen und Abteilungs-Zugehörigkeiten
              dieses Mitglieds werden vollständig durch die Werte aus dem Snapshot ersetzt.
            </p>
          ) : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmField !== null}
        onOpenChange={(o) => {
          if (!restoreField.isPending && !o) setConfirmField(null);
        }}
        title={`Feld „${confirmField ? fieldLabel(confirmField) : ""}“ zurücksetzen`}
        description="Setzt nur dieses eine Feld auf den Wert aus dem Snapshot zurück. Andere Felder bleiben unberührt."
        confirmLabel="Zurücksetzen"
        loading={restoreField.isPending}
        onConfirm={() => {
          if (confirmField) restoreField.mutate({ fieldName: confirmField });
        }}
      >
        {confirmField && detail.diffVsCurrent?.member[confirmField] ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-medium text-muted-foreground">Snapshot</div>
              <div>
                {formatAuditValue(confirmField, detail.diffVsCurrent.member[confirmField].before)}
              </div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Aktuell</div>
              <div>
                {formatAuditValue(confirmField, detail.diffVsCurrent.member[confirmField].after)}
              </div>
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function sumDepChanges(d: SnapshotDetail["diffVsCurrent"]): {
  added: number;
  removed: number;
  changed: number;
} {
  if (!d) return { added: 0, removed: 0, changed: 0 };
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const key of [
    "contracts",
    "sepa",
    "attachments",
    "relationships",
    "memberAbteilungen",
    "sollstellungen",
  ] as const) {
    const v = d[key] as { added: number; removed: number; changedIds?: string[] };
    added += v.added;
    removed += v.removed;
    changed += v.changedIds?.length ?? 0;
  }
  return { added, removed, changed };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
