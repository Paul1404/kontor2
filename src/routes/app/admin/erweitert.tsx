import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  FileWarning,
  ScrollText,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog, TypeToConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { formatCurrency, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/admin/erweitert")({
  beforeLoad: async () => {
    try {
      const me = await orpc.auth.me();
      if (me.role !== "admin") throw redirect({ to: "/app" });
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: DangerZonePage,
});

// Phrases must match the server constants exactly. Kept inline so the
// UI shows the user exactly what to type without a server round-trip.
const PHRASES = {
  deleteOrphanKontakts: "VERWAISTE KONTAKTE LÖSCHEN",
  purgeSoftDeleted: "GELÖSCHTE MITGLIEDER ENDGÜLTIG ENTFERNEN",
  trimAuditLog: "AUDIT LOG KÜRZEN",
  wipeEverything: "ALLES UNWIDERRUFLICH LÖSCHEN",
} as const;

function DangerZonePage() {
  const overview = useQuery({
    queryKey: ["dangerZone.overview"],
    queryFn: () => orpc.dangerZone.overview(),
  });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-destructive" />
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Adminbereich</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Experimentelle und destruktive Funktionen. Alle Aktionen sind nicht umkehrbar (außer
          Snapshots wurden zuvor erstellt) und werden im Audit Log protokolliert.
        </p>
      </div>

      <OrphanKontaktsCard count={overview.data?.orphanKontakts ?? 0} loading={overview.isLoading} />
      <PurgeSoftDeletedCard
        count={overview.data?.softDeletedMembers ?? 0}
        loading={overview.isLoading}
      />
      <SettleHistoricalCard />
      <TrimAuditCard totalEntries={overview.data?.auditEntries ?? 0} loading={overview.isLoading} />
      <WipeEverythingCard memberCount={overview.data?.members ?? 0} loading={overview.isLoading} />
    </div>
  );
}

function DangerCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border-destructive/20">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            {icon}
          </div>
          <div className="flex flex-col gap-0.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function SettleHistoricalCard() {
  const qc = useQueryClient();
  const [throughYear, setThroughYear] = useState(() => new Date().getUTCFullYear() - 1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["dunning.settleHistoricalPreview", throughYear],
    queryFn: () => orpc.dunning.settleHistoricalPreview({ throughYear }),
  });
  const mut = useMutation({
    mutationFn: () =>
      orpc.dunning.settleHistorical({ throughYear, expectedCount: preview.data?.count ?? 0 }),
    onSuccess: async (res) => {
      toast.success(`${res.count} Altposten als eingezogen markiert`);
      setDialogOpen(false);
      await qc.invalidateQueries({ queryKey: ["dunning.settleHistoricalPreview"] });
      await qc.invalidateQueries({ queryKey: ["dunning.open"] });
    },
    onError: (e) =>
      toast.error("Abgleich fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  const count = preview.data?.count ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-600/10 text-sky-600">
            <Banknote className="size-5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <CardTitle>Alt-Lastschriften abgleichen</CardTitle>
            <CardDescription>
              Markiert offene Sollstellungen von Lastschriftzahlern bis zum gewählten Jahr als
              eingezogen. SEPA-Lastschriften gelten als eingezogen, solange kein Rückläufer erfasst
              wurde. Rechnungszahler bleiben offen. Reversibel durch Erfassen eines Rückläufers.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Input component below. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Bis einschließlich Jahr</span>
            <Input
              type="number"
              min={2000}
              max={2100}
              value={throughYear}
              onChange={(e) => setThroughYear(Number(e.target.value) || throughYear)}
              className="w-32"
            />
          </label>
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">Betroffene Posten</span>
            {preview.isLoading ? (
              <Skeleton className="mt-1 h-6 w-16" />
            ) : (
              <span className="text-2xl font-semibold tabular-nums">
                {count}
                {count > 0 ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {formatCurrency(preview.data?.openSum ?? "0")}
                  </span>
                ) : null}
              </span>
            )}
          </div>
          <Button
            size="sm"
            disabled={preview.isLoading || count === 0}
            onClick={() => setDialogOpen(true)}
          >
            <Banknote className="size-4" /> Als eingezogen markieren
          </Button>
        </div>
        <ConfirmDialog
          open={dialogOpen}
          onOpenChange={(v) => {
            if (!mut.isPending) setDialogOpen(v);
          }}
          title="Alt-Lastschriften als eingezogen markieren"
          description={`${count} Posten (${formatCurrency(preview.data?.openSum ?? "0")}) von Lastschriftzahlern bis einschließlich ${throughYear} werden auf "eingezogen" gesetzt und verschwinden aus den Forderungen.`}
          confirmLabel={`${count} Posten abgleichen`}
          loading={mut.isPending}
          onConfirm={() => mut.mutate()}
        >
          {(preview.data?.byYear.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Nach Jahr</p>
              <ul className="flex flex-col gap-0.5">
                {preview.data?.byYear.map((y) => (
                  <li
                    key={y.year}
                    className="flex items-center justify-between gap-3 py-0.5 text-sm"
                  >
                    <span className="tabular-nums">{y.year}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {y.count} Posten · {formatCurrency(y.openSum)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}

function OrphanKontaktsCard({ count, loading }: { count: number; loading: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["dangerZone.previewOrphanKontakts"],
    queryFn: () => orpc.dangerZone.previewOrphanKontakts(),
    enabled: dialogOpen,
  });
  const mut = useMutation({
    mutationFn: (confirmation: string) => orpc.dangerZone.deleteOrphanKontakts({ confirmation }),
    onSuccess: async (res) => {
      toast.success(`${res.deleted} verwaiste Kontakte gelöscht`);
      setDialogOpen(false);
      await qc.invalidateQueries({ queryKey: ["dangerZone.overview"] });
      await qc.invalidateQueries({ queryKey: ["members.list"] });
    },
    onError: (e) =>
      toast.error("Löschen fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });
  return (
    <DangerCard
      icon={<Users className="size-5" />}
      title="Verwaiste Kontakte löschen"
      description="Kontakte (ohne Mitgliedsnummer) ohne jegliche Beziehung in beide Richtungen. Übrig gebliebene Linear-Importzeilen ohne Zweck."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
        <div className="flex flex-col">
          <span className="text-muted-foreground">Aktuell verwaist</span>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-12" />
          ) : (
            <span className="text-2xl font-semibold tabular-nums">{count}</span>
          )}
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={loading || count === 0}
          onClick={() => setDialogOpen(true)}
        >
          <Trash2 className="size-4" /> Bereinigen
        </Button>
      </div>
      <TypeToConfirmDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!mut.isPending) setDialogOpen(v);
        }}
        title="Verwaiste Kontakte löschen"
        description={`Diese Aktion entfernt ${preview.data?.total ?? count} Kontakteinträge endgültig. Eine Wiederherstellung über Snapshots ist nicht möglich, da diese Einträge nie versioniert wurden.`}
        confirmPhrase={PHRASES.deleteOrphanKontakts}
        confirmLabel={`${preview.data?.total ?? count} Kontakte löschen`}
        loading={mut.isPending}
        onConfirm={() => mut.mutate(PHRASES.deleteOrphanKontakts)}
      >
        {preview.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (preview.data?.sample.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">Keine verwaisten Kontakte vorhanden.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Vorschau (max. 50)
            </p>
            <ul className="flex flex-col gap-0.5">
              {preview.data?.sample.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="truncate">
                    {[s.vorname, s.nachname].filter(Boolean).join(" ") ||
                      s.firma1 ||
                      `AdrNr ${s.adrNr}`}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    AdrNr {s.adrNr}
                    {s.ort ? ` · ${s.ort}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TypeToConfirmDialog>
    </DangerCard>
  );
}

function PurgeSoftDeletedCard({ count, loading }: { count: number; loading: boolean }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(90);
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["dangerZone.previewSoftDeleted", days],
    queryFn: () => orpc.dangerZone.previewSoftDeleted({ olderThanDays: days }),
    enabled: dialogOpen,
  });
  const mut = useMutation({
    mutationFn: () =>
      orpc.dangerZone.purgeSoftDeleted({
        olderThanDays: days,
        confirmation: PHRASES.purgeSoftDeleted,
      }),
    onSuccess: async (res) => {
      toast.success(`${res.purged} Mitglieder endgültig entfernt`);
      setDialogOpen(false);
      await qc.invalidateQueries({ queryKey: ["dangerZone.overview"] });
    },
    onError: (e) =>
      toast.error("Löschen fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });
  return (
    <DangerCard
      icon={<UserMinus className="size-5" />}
      title="Soft-gelöschte Mitglieder endgültig entfernen"
      description="Mitglieder, deren Löschung länger als die gewählte Frist zurückliegt, werden inkl. aller verknüpften Daten (Verträge, SEPA, Anhänge) physisch entfernt."
    >
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Aktuell soft-gelöscht (gesamt)
          </span>
          {loading ? (
            <Skeleton className="h-6 w-12" />
          ) : (
            <span className="text-2xl font-semibold tabular-nums">{count}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Input component below. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Älter als (Tage)</span>
            <Input
              type="number"
              min={0}
              max={3650}
              value={days}
              onChange={(e) => setDays(Math.max(0, Math.min(3650, Number(e.target.value) || 0)))}
              className="w-24"
            />
          </label>
          <Button
            variant="destructive"
            size="sm"
            disabled={loading || count === 0}
            onClick={() => setDialogOpen(true)}
          >
            <Trash2 className="size-4" /> Endgültig
          </Button>
        </div>
      </div>
      <TypeToConfirmDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!mut.isPending) setDialogOpen(v);
        }}
        title="Soft-gelöschte Mitglieder endgültig entfernen"
        description={`Entfernt ${preview.data?.total ?? "…"} Mitglieder unwiderruflich (gelöscht vor mehr als ${days} Tagen). Audit-Einträge bleiben bestehen, das Mitglied selbst nicht mehr referenzierbar.`}
        confirmPhrase={PHRASES.purgeSoftDeleted}
        confirmLabel="Endgültig entfernen"
        loading={mut.isPending}
        onConfirm={() => mut.mutate()}
      >
        {preview.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (preview.data?.sample.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">
            Keine Mitglieder erfüllen das Kriterium (gelöscht vor mehr als {days} Tagen).
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Vorschau (max. 50)
            </p>
            <ul className="flex flex-col gap-0.5">
              {preview.data?.sample.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="truncate">
                    {[s.vorname, s.nachname].filter(Boolean).join(" ") || `AdrNr ${s.adrNr}`}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {s.mitglnr ? `#${s.mitglnr}` : `AdrNr ${s.adrNr}`} ·{" "}
                    {s.deletedAt ? formatDateTime(s.deletedAt) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TypeToConfirmDialog>
    </DangerCard>
  );
}

function TrimAuditCard({ totalEntries, loading }: { totalEntries: number; loading: boolean }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(730);
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["dangerZone.previewAuditTrim", days],
    queryFn: () => orpc.dangerZone.previewAuditTrim({ olderThanDays: days }),
    enabled: dialogOpen,
  });
  const mut = useMutation({
    mutationFn: () =>
      orpc.dangerZone.trimAuditLog({
        olderThanDays: days,
        confirmation: PHRASES.trimAuditLog,
      }),
    onSuccess: async (res) => {
      toast.success(`${res.deleted} Audit-Einträge gelöscht`);
      setDialogOpen(false);
      await qc.invalidateQueries({ queryKey: ["dangerZone.overview"] });
      await qc.invalidateQueries({ queryKey: ["audit.list"] });
    },
    onError: (e) =>
      toast.error("Kürzen fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });
  return (
    <DangerCard
      icon={<ScrollText className="size-5" />}
      title="Audit Log kürzen"
      description="Entfernt Audit-Einträge, die älter als die gewählte Frist sind. Damit verlieren Sie die historische Nachvollziehbarkeit für diese Zeitspanne."
    >
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Einträge gesamt
          </span>
          {loading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <span className="text-2xl font-semibold tabular-nums">{totalEntries}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Input component below. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Älter als (Tage)</span>
            <Input
              type="number"
              min={30}
              value={days}
              onChange={(e) => setDays(Math.max(30, Number(e.target.value) || 30))}
              className="w-24"
            />
          </label>
          <Button
            variant="destructive"
            size="sm"
            disabled={loading || totalEntries === 0}
            onClick={() => setDialogOpen(true)}
          >
            <Trash2 className="size-4" /> Kürzen
          </Button>
        </div>
      </div>
      <TypeToConfirmDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!mut.isPending) setDialogOpen(v);
        }}
        title="Audit Log kürzen"
        description={
          <>
            Löscht <strong className="text-foreground">{preview.data?.total ?? "…"}</strong>{" "}
            Audit-Einträge älter als{" "}
            <strong className="text-foreground">
              {preview.data?.threshold ? formatDateTime(preview.data.threshold) : "…"}
            </strong>
            .
          </>
        }
        confirmPhrase={PHRASES.trimAuditLog}
        confirmLabel="Audit kürzen"
        loading={mut.isPending}
        onConfirm={() => mut.mutate()}
      >
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Ältester vorhandener Eintrag:</span>
            <span className="tabular-nums">
              {preview.data?.oldestEntry ? formatDateTime(preview.data.oldestEntry) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Schwellwert:</span>
            <span className="tabular-nums">
              {preview.data?.threshold ? formatDateTime(preview.data.threshold) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Zu löschen:</span>
            <span className="font-semibold text-foreground tabular-nums">
              {preview.data?.total ?? "…"}
            </span>
          </div>
        </div>
      </TypeToConfirmDialog>
    </DangerCard>
  );
}

function WipeEverythingCard({ memberCount, loading }: { memberCount: number; loading: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["dangerZone.previewWipe"],
    queryFn: () => orpc.dangerZone.previewWipe(),
    enabled: dialogOpen,
  });
  const mut = useMutation({
    mutationFn: () =>
      orpc.dangerZone.wipeEverything({
        confirmation: PHRASES.wipeEverything,
        confirmationAgain: PHRASES.wipeEverything,
      }),
    onSuccess: async () => {
      toast.success("Alle Daten gelöscht. Frischer Stand.");
      setDialogOpen(false);
      await qc.invalidateQueries();
    },
    onError: (e) =>
      toast.error("Wipe fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });
  return (
    <DangerCard
      icon={<FileWarning className="size-5" />}
      title="Alles unwiderruflich löschen"
      description="Werkseinstellungen: Mitglieder, Verträge, SEPA, Anhänge, Beziehungen, Snapshots, Beitragsläufe, DSGVO und Audit Log werden geleert. Benutzer, Abteilungen, Beitragsarten und Einstellungen bleiben erhalten."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">
            Aktuell verwaltete Mitglieder:{" "}
            {loading ? (
              <Skeleton className="inline-block h-3 w-8 align-middle" />
            ) : (
              <span className="tabular-nums">{memberCount}</span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            Diese Aktion lässt sich nicht rückgängig machen.
          </span>
        </div>
        <Button variant="destructive" disabled={loading} onClick={() => setDialogOpen(true)}>
          <Trash2 className="size-4" /> Alles löschen
        </Button>
      </div>
      <TypeToConfirmDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!mut.isPending) setDialogOpen(v);
        }}
        title="Werkseinstellungen wiederherstellen"
        description="Alle Datentabellen werden geleert. Benutzer, Stammdaten (Abteilungen, Beitragsarten) und Einstellungen bleiben erhalten."
        confirmPhrase={PHRASES.wipeEverything}
        doubleConfirm
        confirmLabel="Alles löschen"
        loading={mut.isPending}
        onConfirm={() => mut.mutate()}
      >
        {preview.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="flex flex-col gap-1">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Folgende Daten werden gelöscht:
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
              {preview.data?.counts.map((c) => (
                <li key={c.label} className="flex items-center justify-between">
                  <span>{c.label}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TypeToConfirmDialog>
    </DangerCard>
  );
}
