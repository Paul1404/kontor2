import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Database, Loader2, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { formatBytes, formatDateTime } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/admin/snapshots")({
  component: AdminSnapshotsPage,
});

type Trigger = "mutation" | "nightly" | "manual" | "pre_restore" | "pre_import";

const TRIGGER_LABEL: Record<Trigger, string> = {
  mutation: "Änderung",
  nightly: "Nächtlich",
  manual: "Manuell",
  pre_restore: "Vor Restore",
  pre_import: "Vor Import",
};

function AdminSnapshotsPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<Trigger | null>(null);
  const runs = useQuery({
    queryKey: ["snapshots.listRuns", triggerFilter],
    queryFn: () => orpc.snapshots.listRuns({ trigger: triggerFilter, limit: 50, cursor: null }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
        <p className="text-sm text-muted-foreground">
          Vollständige Backups jedes Mitglieds bei Änderungen und einmal pro Nacht. Bei einem
          missglückten Massen-Import (oder einem falschen manuellen Eingriff) lassen sich Mitglieder
          zielgenau zurücksetzen.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Filter:
        </span>
        <FilterPill active={triggerFilter === null} onClick={() => setTriggerFilter(null)}>
          Alle
        </FilterPill>
        {(["nightly", "pre_import", "manual", "mutation"] as Trigger[]).map((t) => (
          <FilterPill key={t} active={triggerFilter === t} onClick={() => setTriggerFilter(t)}>
            {TRIGGER_LABEL[t]}
          </FilterPill>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" /> Snapshot-Läufe
          </CardTitle>
          <CardDescription>
            Ein Lauf bündelt die Snapshots, die in einer Operation entstanden sind (nächtlicher Lauf
            oder Vor-Import-Lauf).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {runs.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Wird geladen…</p>
          ) : runs.isError ? (
            <div className="p-6">
              <QueryError
                title="Snapshots konnten nicht geladen werden"
                error={runs.error}
                onRetry={() => runs.refetch()}
              />
            </div>
          ) : (runs.data?.rows ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Noch keine Snapshot-Läufe vorhanden.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Trigger</th>
                    <th className="px-4 py-2 font-medium">Gestartet</th>
                    <th className="px-4 py-2 font-medium">Abgeschlossen</th>
                    <th className="px-4 py-2 text-right font-medium">Mitglieder</th>
                    <th className="px-4 py-2 text-right font-medium">Größe</th>
                    <th className="px-4 py-2 font-medium">Notiz</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(runs.data?.rows ?? []).map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Badge variant="outline">{TRIGGER_LABEL[r.trigger as Trigger]}</Badge>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{formatDateTime(r.startedAt)}</td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {r.finishedAt ? formatDateTime(r.finishedAt) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.memberCount}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {formatBytes(r.bytesTotal)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedRunId(r.id)}
                        >
                          Inhalt <ChevronRight className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRunId ? (
        <RunDetail runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      ) : null}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-0.5 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

type RunSnapshot = {
  id: string;
  memberId: string;
  createdAt: string | Date;
  byteSize: number;
  contentHash: string;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  adrNr: number;
  vorname: string | null;
  nachname: string | null;
};

function RunDetail({ runId, onClose }: { runId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["snapshots.getRun", runId],
    queryFn: () => orpc.snapshots.getRun({ runId }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeDependents, setIncludeDependents] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    perMember: Array<{ memberId: string; ok: boolean; error?: string; changedFieldCount?: number }>;
  } | null>(null);

  const snapshots = (detail.data?.snapshots ?? []) as RunSnapshot[];
  const allMemberIds = useMemo(() => snapshots.map((s) => s.memberId), [snapshots]);
  const allSelected = selected.size > 0 && selected.size === allMemberIds.length;

  const dryRun = useMutation({
    mutationFn: () =>
      orpc.snapshots.bulkRestore({
        snapshotRunId: runId,
        memberIds: Array.from(selected),
        includeDependents,
        dryRun: true,
      }),
    onSuccess: (data) => {
      setDryRunResult(data);
      setConfirmOpen(true);
    },
    onError: (err) =>
      toast.error("Vorschau fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const apply = useMutation({
    mutationFn: () =>
      orpc.snapshots.bulkRestore({
        snapshotRunId: runId,
        memberIds: Array.from(selected),
        includeDependents,
        dryRun: false,
      }),
    onSuccess: async (data) => {
      const failed = data.perMember.filter((m) => !m.ok);
      if (failed.length === 0) {
        toast.success(`${data.perMember.length} Mitglieder wiederhergestellt`);
      } else {
        toast.error(
          `${data.perMember.length - failed.length} OK, ${failed.length} fehlgeschlagen`,
          {
            description: failed
              .map((f) => f.error)
              .filter(Boolean)
              .join(", ")
              .slice(0, 200),
          },
        );
      }
      setConfirmOpen(false);
      setSelected(new Set());
      setDryRunResult(null);
      await qc.invalidateQueries({ queryKey: ["members.list"] });
    },
    onError: (err) =>
      toast.error("Wiederherstellung fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Lauf-Details</CardTitle>
          <CardDescription>
            {snapshots.length} Snapshots im Lauf. Wähle Mitglieder aus, um sie auf den Zustand
            dieses Laufs zurückzusetzen.
          </CardDescription>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Schließen
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={detail.isLoading || detail.isError}
                onChange={(e) => {
                  if (e.target.checked) setSelected(new Set(allMemberIds));
                  else setSelected(new Set());
                }}
              />
              Alle auswählen ({selected.size} / {snapshots.length})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDependents}
                disabled={detail.isLoading || detail.isError}
                onChange={(e) => setIncludeDependents(e.target.checked)}
              />
              Abhängige Datensätze einbeziehen
            </label>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={detail.isError || selected.size === 0 || dryRun.isPending}
            onClick={() => dryRun.mutate()}
          >
            {dryRun.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Auswahl wiederherstellen
          </Button>
        </div>
        {detail.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Wird geladen…</p>
        ) : detail.isError ? (
          <div className="p-6">
            <QueryError
              title="Snapshot-Inhalt konnte nicht geladen werden"
              error={detail.error}
              onRetry={() => detail.refetch()}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-4 py-2" />
                  <th className="px-4 py-2 font-medium">Nr.</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Erfasst</th>
                  <th className="px-4 py-2 text-right font-medium">Größe</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshots.map((s) => {
                  const isSel = selected.has(s.memberId);
                  return (
                    <tr key={s.id} className={`hover:bg-muted/30 ${isSel ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (isSel) next.delete(s.memberId);
                              else next.add(s.memberId);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {memberRef(s) || <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {[s.vorname, s.nachname].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {formatDateTime(s.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {formatBytes(s.byteSize)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: memberRef(s) }}
                          className="text-xs text-primary hover:underline"
                        >
                          Mitglied →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!apply.isPending) {
            setConfirmOpen(o);
            if (!o) setDryRunResult(null);
          }
        }}
        title={`${selected.size} Mitglieder wiederherstellen?`}
        description={`Setzt die ausgewählten Mitglieder auf den Stand dieses Laufs zurück. Vor der Änderung wird für jedes Mitglied ein eigener Pre-Restore-Snapshot angelegt.`}
        confirmLabel="Jetzt wiederherstellen"
        destructive
        loading={apply.isPending}
        onConfirm={() => apply.mutate()}
      >
        {dryRunResult ? (
          <div className="flex flex-col gap-2 text-xs">
            <div className="text-muted-foreground">
              Vorschau:{" "}
              {dryRunResult.perMember.reduce((sum, m) => sum + (m.changedFieldCount ?? 0), 0)}{" "}
              Felder werden über {dryRunResult.perMember.length} Mitglieder zurückgesetzt.
              {includeDependents
                ? " Verträge, SEPA-Mandate, Beziehungen und Abteilungen werden ebenfalls ersetzt."
                : ""}
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
