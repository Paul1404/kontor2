import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  MailCheck,
  MailWarning,
  MailX,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { PageSizeSelect, usePersistentPageSize } from "~/components/ui/page-size-select";
import { QueryError } from "~/components/ui/query-error";
import { Skeleton } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { formatDateTime, orEmpty } from "~/lib/format";
import { useModalFocus } from "~/lib/modal-focus";
import { orpc } from "~/lib/orpc";

type Status = "sent" | "failed" | "skipped";

type MailSearch = {
  q: string;
  status: Status | "";
  kind: string;
  from: string;
  to: string;
};

const EMPTY_SEARCH: MailSearch = { q: "", status: "", kind: "", from: "", to: "" };

const STATUS_META: Record<
  Status,
  { label: string; badge: string; icon: typeof MailCheck; accent: string }
> = {
  sent: {
    label: "Versendet",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: MailCheck,
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  failed: {
    label: "Fehlgeschlagen",
    badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    icon: MailX,
    accent: "text-red-600 dark:text-red-400",
  },
  skipped: {
    label: "Übersprungen",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: MailWarning,
    accent: "text-amber-600 dark:text-amber-400",
  },
};

// Human labels for the documented mail kinds; an unknown kind falls back to itself.
const KIND_LABEL: Record<string, string> = {
  antrag_confirmation: "Antrag: Bestätigung",
  antrag_club_notification: "Antrag: Vereinsbenachrichtigung",
  antrag_approval: "Antrag: Genehmigung",
  antrag_decline: "Antrag: Ablehnung",
  bank_details_confirmation: "Bankänderung: Bestätigung",
  dunning: "Mahnung",
  invite: "Benutzereinladung",
  portal_invite: "Portalzugang",
  test_mail: "Test-E-Mail",
};

const DETAIL_LABEL: Record<string, string> = {
  smtp_not_configured: "Kein E-Mail-Versand eingerichtet",
  no_recipient: "Keine E-Mail-Adresse hinterlegt",
  not_sent: "Nicht versendet",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function detailLabel(detail: string | null): string | null {
  if (!detail) return null;
  return DETAIL_LABEL[detail] ?? detail;
}

export const Route = createFileRoute("/app/admin/versandprotokoll")({
  beforeLoad: async () => {
    let me: Awaited<ReturnType<typeof orpc.auth.me>>;
    try {
      me = await orpc.auth.me();
    } catch {
      throw redirect({ to: "/login" });
    }
    if (me.role !== "admin") throw redirect({ to: "/app" });
  },
  component: VersandprotokollPage,
  validateSearch: (s: Record<string, unknown>): MailSearch => ({
    q: typeof s.q === "string" ? s.q : "",
    status: (typeof s.status === "string" ? s.status : "") as Status | "",
    kind: typeof s.kind === "string" ? s.kind : "",
    from: typeof s.from === "string" ? s.from : "",
    to: typeof s.to === "string" ? s.to : "",
  }),
});

function VersandprotokollPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistentPageSize("emailLog.pageSize", 50);
  const [qDraft, setQDraft] = useState(search.q);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [selectedMailId, setSelectedMailId] = useState<string | null>(null);

  useEffect(() => {
    setQDraft(search.q);
  }, [search.q]);

  const range = { from: search.from || null, to: search.to || null };

  const stats = useQuery({
    queryKey: ["emailLog.stats", range],
    queryFn: () => orpc.emailLog.stats(range),
  });

  const list = useQuery({
    queryKey: ["emailLog.list", { ...search, page, pageSize }],
    queryFn: () =>
      orpc.emailLog.list({
        page,
        pageSize,
        q: search.q,
        status: (search.status || null) as Status | null,
        kind: search.kind || null,
        from: search.from || null,
        to: search.to || null,
      }),
  });

  const purge = useMutation({
    mutationFn: (olderThanDays: number | null) => orpc.emailLog.purge({ olderThanDays }),
    onSuccess: (res) => {
      toast.success(`${res.deleted} Einträge gelöscht.`);
      setPurgeOpen(false);
      queryClient.invalidateQueries({ queryKey: ["emailLog.list"] });
      queryClient.invalidateQueries({ queryKey: ["emailLog.stats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Löschen fehlgeschlagen."),
  });

  function updateSearch(patch: Partial<MailSearch>) {
    setPage(1);
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  }

  function refreshNow() {
    queryClient.invalidateQueries({ queryKey: ["emailLog.list"] });
    queryClient.invalidateQueries({ queryKey: ["emailLog.stats"] });
  }

  const hasFilter = !!search.q || !!search.status || !!search.kind || !!search.from || !!search.to;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Versandprotokoll</h1>
          <p className="text-sm text-muted-foreground">
            Alle von Kontor2 versendeten E-Mails an einer Stelle: Antragsbestätigungen, Mahnungen,
            Einladungen und Portalzugänge. Zeigt, ob eine Nachricht versendet, übersprungen oder
            fehlgeschlagen ist.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshNow}
            disabled={list.isFetching}
            aria-label="Aktualisieren"
          >
            <RefreshCw className={cn("size-3.5", list.isFetching && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPurgeOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> Leeren
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Gesamt"
          value={stats.data?.total ?? 0}
          loading={stats.isLoading}
          active={search.status === ""}
          onClick={() => updateSearch({ status: "" })}
        />
        <StatCard
          label="Versendet"
          value={stats.data?.sent ?? 0}
          loading={stats.isLoading}
          status="sent"
          active={search.status === "sent"}
          onClick={() => updateSearch({ status: search.status === "sent" ? "" : "sent" })}
        />
        <StatCard
          label="Übersprungen"
          value={stats.data?.skipped ?? 0}
          loading={stats.isLoading}
          status="skipped"
          active={search.status === "skipped"}
          onClick={() => updateSearch({ status: search.status === "skipped" ? "" : "skipped" })}
        />
        <StatCard
          label="Fehlgeschlagen"
          value={stats.data?.failed ?? 0}
          loading={stats.isLoading}
          status="failed"
          active={search.status === "failed"}
          onClick={() => updateSearch({ status: search.status === "failed" ? "" : "failed" })}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Suche in Empfänger, Betreff, Typ oder Auslöser"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") updateSearch({ q: qDraft });
              }}
              onBlur={() => {
                if (qDraft !== search.q) updateSearch({ q: qDraft });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Typ</span>
            <select
              value={search.kind}
              onChange={(e) => updateSearch({ kind: e.target.value })}
              className="h-9 min-w-40 rounded-md border border-input bg-card px-2 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">Alle</option>
              {(stats.data?.kinds ?? []).map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Von</span>
            <DateField
              value={search.from}
              onChange={(v) => updateSearch({ from: v })}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Bis</span>
            <DateField
              value={search.to}
              onChange={(v) => updateSearch({ to: v })}
              className="h-9 w-40"
            />
          </div>
          {hasFilter ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQDraft("");
                navigate({ search: () => EMPTY_SEARCH, replace: true });
                setPage(1);
              }}
            >
              <X className="size-3.5" /> Filter zurücksetzen
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {list.isLoading ? (
            Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-5 w-24" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-72" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-3 w-28" />
              </li>
            ))
          ) : list.isError ? (
            <li className="px-4 py-6">
              <QueryError error={list.error} onRetry={() => list.refetch()} />
            </li>
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              Keine Einträge passen zu diesen Filtern.
            </li>
          ) : (
            list.data?.rows.map((r) => (
              <MailRow key={r.id} row={r as MailRowData} onView={() => setSelectedMailId(r.id)} />
            ))
          )}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {(list.data?.total ?? 0).toLocaleString("de-DE")} Einträge
            {stats.data?.lastEventAt ? (
              <span className="ml-2">· zuletzt {formatDateTime(stats.data.lastEventAt)}</span>
            ) : null}
          </span>
          <div className="flex items-center gap-4">
            <PageSizeSelect
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <span className="text-muted-foreground">Seite {page}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page * pageSize >= (list.data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                Weiter <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Versandprotokoll leeren"
        description="Lösche Einträge dauerhaft aus der Datenbank. Älter als 90 Tage entfernt nur ältere Einträge, Alles löschen leert das gesamte Protokoll."
        destructive
        confirmLabel="Alles löschen"
        cancelLabel="Abbrechen"
        loading={purge.isPending}
        onConfirm={() => purge.mutate(null)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={purge.isPending}
          onClick={() => purge.mutate(90)}
        >
          Nur Einträge älter als 90 Tage löschen
        </Button>
      </ConfirmDialog>

      <MailDetailDialog
        id={selectedMailId}
        open={selectedMailId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedMailId(null);
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  status,
  active,
  onClick,
}: {
  label: string;
  value: number;
  loading: boolean;
  status?: Status;
  active: boolean;
  onClick: () => void;
}) {
  const meta = status ? STATUS_META[status] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-colors",
        active ? "border-ring ring-2 ring-ring/20" : "border-border hover:border-ring/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {meta ? <meta.icon className={cn("size-3.5", meta.accent)} /> : null}
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-7 w-14" />
      ) : (
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            meta && value > 0 ? meta.accent : "text-foreground",
          )}
        >
          {value.toLocaleString("de-DE")}
        </span>
      )}
    </button>
  );
}

type MailRowData = {
  id: string;
  kind: string;
  status: Status;
  recipient: string | null;
  subject: string | null;
  detail: string | null;
  actorEmail: string | null;
  hasContent: boolean;
  createdAt: string | Date;
};

function MailRow({ row, onView }: { row: MailRowData; onView: () => void }) {
  const meta = STATUS_META[row.status];
  const detail = detailLabel(row.detail);
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className={cn("font-medium", meta.badge)}>
            {meta.label}
          </Badge>
          <span className="font-medium">{kindLabel(row.kind)}</span>
          {row.subject ? (
            <span className="break-all text-muted-foreground">{row.subject}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>An: {orEmpty(row.recipient)}</span>
          {row.actorEmail ? <span>von {row.actorEmail}</span> : null}
          {detail ? <span className={meta.accent}>{detail}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {formatDateTime(row.createdAt)}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onView}>
          <Eye className="size-3.5" />
          {row.hasContent || row.status === "sent" ? "Ansehen" : "Details"}
        </Button>
      </div>
    </li>
  );
}

type MailDetail = Omit<MailRowData, "hasContent"> & {
  bodyText: string | null;
  bodyHtml: string | null;
  attachmentNames: string[] | null;
  entityType: string | null;
  entityId: string | null;
  contentSource: "archive" | "imap" | "none" | "unavailable";
  imapMailbox?: string;
};

function MailDetailDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<"html" | "text">("html");
  const detail = useQuery({
    queryKey: ["emailLog.get", id],
    queryFn: () => orpc.emailLog.get({ id: id! }),
    enabled: open && id !== null,
  });
  useModalFocus({
    open,
    containerRef: dialogRef,
    initialFocusRef: closeRef,
    onEscape: () => onOpenChange(false),
  });
  useEffect(() => {
    if (open) setView("html");
  }, [open]);

  if (!open) return null;
  const mail = detail.data as MailDetail | undefined;
  const meta = mail ? STATUS_META[mail.status] : null;
  const safeHtml = mail?.bodyHtml
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'">${mail.bodyHtml}`
    : null;
  const showHtml = !!safeHtml && view === "html";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is dismissible by click; Escape and the close button cover keyboard use.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mail-detail-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="motion-zoom-in flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="mail-detail-title" className="text-base font-semibold tracking-tight">
                {mail?.status === "sent" ? "Versendete E-Mail" : "E-Mail-Details"}
              </h2>
              {meta ? (
                <Badge variant="outline" className={cn("font-medium", meta.badge)}>
                  {meta.label}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {mail?.contentSource === "imap"
                ? `Schreibgeschützt aus dem IMAP-Ordner „${mail.imapMailbox ?? "Gesendet"}“`
                : "Schreibgeschützte Momentaufnahme aus dem Versandprotokoll"}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Schließen"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {detail.isLoading ? (
            <div className="flex flex-col gap-3 p-5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-72 w-full" />
            </div>
          ) : detail.isError ? (
            <div className="p-5">
              <QueryError error={detail.error} onRetry={() => detail.refetch()} />
            </div>
          ) : mail ? (
            <>
              <dl className="grid gap-x-6 gap-y-3 border-b border-border bg-muted/20 px-5 py-4 text-sm sm:grid-cols-[7rem_1fr]">
                <dt className="text-muted-foreground">An</dt>
                <dd className="break-all font-medium">{orEmpty(mail.recipient)}</dd>
                <dt className="text-muted-foreground">Betreff</dt>
                <dd className="break-words font-medium">{orEmpty(mail.subject)}</dd>
                <dt className="text-muted-foreground">Versand</dt>
                <dd>{formatDateTime(mail.createdAt)}</dd>
                <dt className="text-muted-foreground">Typ</dt>
                <dd>{kindLabel(mail.kind)}</dd>
                {mail.contentSource === "archive" || mail.contentSource === "imap" ? (
                  <>
                    <dt className="text-muted-foreground">Quelle</dt>
                    <dd>
                      {mail.contentSource === "imap"
                        ? `Gesendet-Ordner (${mail.imapMailbox ?? "automatisch erkannt"})`
                        : "Kontor²-Versandarchiv"}
                    </dd>
                  </>
                ) : null}
                {mail.actorEmail ? (
                  <>
                    <dt className="text-muted-foreground">Ausgelöst von</dt>
                    <dd className="break-all">{mail.actorEmail}</dd>
                  </>
                ) : null}
                {mail.attachmentNames?.length ? (
                  <>
                    <dt className="text-muted-foreground">Anhänge</dt>
                    <dd className="flex flex-wrap gap-2">
                      {mail.attachmentNames.map((name) => (
                        <Badge key={name} variant="outline" className="gap-1 font-normal">
                          <FileText className="size-3" /> {name}
                        </Badge>
                      ))}
                    </dd>
                  </>
                ) : null}
                {detailLabel(mail.detail) ? (
                  <>
                    <dt className="text-muted-foreground">Hinweis</dt>
                    <dd className={meta?.accent}>{detailLabel(mail.detail)}</dd>
                  </>
                ) : null}
              </dl>

              <section className="flex min-h-0 flex-1 flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">E-Mail-Inhalt</h3>
                  {mail.bodyHtml && mail.bodyText ? (
                    <div className="flex rounded-lg border border-border p-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={view === "html" ? "secondary" : "ghost"}
                        onClick={() => setView("html")}
                      >
                        HTML-Vorschau
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={view === "text" ? "secondary" : "ghost"}
                        onClick={() => setView("text")}
                      >
                        Nur Text
                      </Button>
                    </div>
                  ) : null}
                </div>
                {showHtml ? (
                  <iframe
                    title="Schreibgeschützte E-Mail-Vorschau"
                    sandbox=""
                    srcDoc={safeHtml}
                    className="min-h-[28rem] w-full rounded-lg border border-border bg-white"
                  />
                ) : mail.bodyText ? (
                  <pre className="min-h-64 whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-5 font-sans text-sm leading-relaxed">
                    {mail.bodyText}
                  </pre>
                ) : mail.bodyHtml ? (
                  <iframe
                    title="Schreibgeschützte E-Mail-Vorschau"
                    sandbox=""
                    srcDoc={safeHtml ?? undefined}
                    className="min-h-[28rem] w-full rounded-lg border border-border bg-white"
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    {mail.contentSource === "unavailable"
                      ? "Der Gesendet-Ordner ist momentan nicht erreichbar. Bitte den IMAP-Zugriff unter E-Mail-Konfiguration prüfen."
                      : "Im Gesendet-Ordner wurde keine eindeutig passende E-Mail gefunden."}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
