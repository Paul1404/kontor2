import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronRight,
  GitMerge,
  ListChecks,
  Loader2,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { ABTEILUNG_NONE_FILTER } from "~/lib/abteilung-filter";
import { cn } from "~/lib/cn";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/datenqualitaet")({
  component: DatenqualitaetPage,
});

type CategoryId =
  | "lastschrift_ohne_mandat"
  | "fehlende_iban"
  | "fehlende_adresse"
  | "name_fehlt"
  | "aktiv_ohne_vertrag"
  | "minderjaehrig_ohne_vertretung"
  | "geburtsdatum_unplausibel"
  | "eintritt_nach_austritt"
  | "austritt_offene_vertraege"
  | "fehlende_email"
  | "email_ungueltig"
  | "email_mehrfach"
  | "plz_ungueltig"
  | "geschlecht_unbekannt"
  | "vertrag_ohne_beitragsart"
  | "mahnsperre_gesetzt"
  | "moegliche_dubletten";

type SeverityFilter = "alle" | "warn" | "info";

function DatenqualitaetPage() {
  const summary = useQuery({
    queryKey: ["dataQuality.summary"],
    queryFn: () => orpc.dataQuality.summary(),
  });
  const [open, setOpen] = useState<CategoryId | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>("alle");
  // Hide the long tail of clean checks by default so the page leads with the
  // problems that actually need attention.
  const [showClean, setShowClean] = useState(false);

  const categories = summary.data?.categories ?? [];
  const warnHits = categories.filter((c) => c.severity === "warn" && c.count > 0).length;
  const infoHits = categories.filter((c) => c.severity === "info" && c.count > 0).length;
  const visible = categories
    .filter((c) => filter === "alle" || c.severity === filter)
    .filter((c) => showClean || c.count > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ListChecks className="size-6 text-brand" /> Datenqualität
        </h1>
        <p className="text-sm text-muted-foreground">
          Findet Lücken und Ungereimtheiten im Bestand, bevor sie beim Beitragslauf, Mahnwesen oder
          Versand auffallen. Jeder Eintrag verlinkt direkt zum Mitglied.
        </p>
      </div>

      {summary.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Prüfe Datenbestand…
        </div>
      ) : summary.isError ? (
        <QueryError onRetry={() => summary.refetch()} />
      ) : summary.data && summary.data.total === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm">
            <ShieldCheck className="size-8 text-emerald-500" />
            <div>
              <div className="font-semibold tracking-tight">Alles sauber.</div>
              <div className="text-muted-foreground">
                Keine offenen Datenqualitäts-Probleme gefunden.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : summary.data ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {summary.data.total}
              </span>{" "}
              offene Hinweise.{" "}
              <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">
                {warnHits}
              </span>{" "}
              Warnungen,{" "}
              <span className="font-medium text-foreground tabular-nums">{infoHits}</span> Hinweise.
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 text-xs">
              {(
                [
                  ["alle", "Alle"],
                  ["warn", "Warnungen"],
                  ["info", "Hinweise"],
                ] as const
              ).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setFilter(val)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    filter === val
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {visible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Keine Treffer in dieser Auswahl.
              </p>
            ) : (
              visible.map((c) => (
                <CategorySection
                  key={c.id}
                  id={c.id as CategoryId}
                  label={c.label}
                  description={c.description}
                  severity={c.severity}
                  count={c.count}
                  open={open === c.id}
                  onToggle={() => setOpen((cur) => (cur === c.id ? null : (c.id as CategoryId)))}
                />
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowClean((v) => !v)}
            className="self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showClean ? "Saubere Prüfungen ausblenden" : "Auch saubere Prüfungen anzeigen"}
          </button>
        </div>
      ) : null}

      <DatenpflegeSection />
    </div>
  );
}

/**
 * Admin-only cleanup tools for legacy reference data: merge a duplicate
 * Beitragsart or Abteilung into the correct one. Both actions reassign
 * everything that pointed at the source and then delete it, so they are gated
 * behind a confirm dialog and the admin role.
 */
function DatenpflegeSection() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me(), retry: false });
  if (me.data?.role !== "admin") return null;
  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Wrench className="size-5 text-brand" /> Datenpflege
        </h2>
        <p className="text-sm text-muted-foreground">
          Doppelte oder veraltete Stammdaten bereinigen. Die Aktionen sind dauerhaft und werden im
          Protokoll festgehalten.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FeeTypeMergeCard />
        <AbteilungMergeCard />
        <KeineAbteilungBackfillCard />
      </div>
    </div>
  );
}

function KeineAbteilungBackfillCard() {
  const qc = useQueryClient();
  // Active members without any department membership. Mirrors the "Ohne
  // Abteilung" filter (members.list defaults to status "aktiv").
  const count = useQuery({
    queryKey: ["members.list", "ohne-abteilung-count"],
    queryFn: () => orpc.members.list({ abteilungId: ABTEILUNG_NONE_FILTER, pageSize: 1 }),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const backfill = useMutation({
    mutationFn: () => orpc.abteilungen.backfillKeineAbteilung(),
    onSuccess: (r) => {
      toast.success("Keine Abteilung zugeordnet.", {
        description: `${r.assigned} Mitglied(er) der Abteilung "Keine Abteilung" zugeordnet.`,
      });
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["abteilungen.list"] });
      qc.invalidateQueries({ queryKey: ["abteilungen"] });
      qc.invalidateQueries({ queryKey: ["members.list"] });
      qc.invalidateQueries({ queryKey: ["dataQuality.summary"] });
    },
    onError: (e: Error) => toast.error("Zuordnen fehlgeschlagen", { description: e.message }),
  });

  const open = count.data?.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-muted-foreground" /> Keine Abteilung zuordnen
        </CardTitle>
        <CardDescription>
          Ordnet aktive Mitglieder ohne Sparte der Abteilung "Keine Abteilung" zu. Legt die
          Abteilung bei Bedarf an. Wiederholbar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {count.isLoading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Zähle Mitglieder…
            </span>
          ) : open > 0 ? (
            <>
              Aktuell <span className="font-semibold tabular-nums text-foreground">{open}</span>{" "}
              aktive Mitglieder ohne Abteilung.
            </>
          ) : (
            "Alle aktiven Mitglieder haben eine Abteilung."
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={backfill.isPending || open === 0}
          onClick={() => setConfirmOpen(true)}
          className="self-start"
        >
          <Users className="size-4" /> Zuordnen
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !backfill.isPending && setConfirmOpen(o)}
        title="Keine Abteilung zuordnen?"
        description={`${open} aktive Mitglieder ohne Sparte werden der Abteilung "Keine Abteilung" zugeordnet. Die Abteilung wird bei Bedarf angelegt.`}
        confirmLabel="Zuordnen"
        loading={backfill.isPending}
        onConfirm={() => backfill.mutate()}
      />
    </Card>
  );
}

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

function FeeTypeMergeCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["feeTypes.list"], queryFn: () => orpc.feeTypes.list() });
  const [fromArt, setFromArt] = useState("");
  const [toArt, setToArt] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const merge = useMutation({
    mutationFn: () => orpc.feeTypes.merge({ fromArt: Number(fromArt), toArt: Number(toArt) }),
    onSuccess: (r) => {
      toast.success("Beitragsart zusammengeführt.", {
        description: `${r.reassigned} Vertrag/Verträge auf Beitragsart ${r.toArt} umgestellt.`,
      });
      setConfirmOpen(false);
      setFromArt("");
      setToArt("");
      qc.invalidateQueries({ queryKey: ["feeTypes.list"] });
      qc.invalidateQueries({ queryKey: ["dataQuality.summary"] });
    },
    onError: (e: Error) => toast.error("Zusammenführen fehlgeschlagen", { description: e.message }),
  });

  const rows = list.data ?? [];
  const valid = fromArt !== "" && toArt !== "" && fromArt !== toArt;
  const fromRow = rows.find((r) => String(r.art) === fromArt);
  const toRow = rows.find((r) => String(r.art) === toArt);
  const label = (r: (typeof rows)[number]) =>
    `${r.art} ${r.bezeichnung ?? "ohne Name"} (${r.contractCount} Verträge)`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="size-4 text-muted-foreground" /> Beitragsart zusammenführen
        </CardTitle>
        <CardDescription>
          Verschiebt alle Verträge der Quelle auf das Ziel und löscht die Quelle. Für doppelte
          Altlasten wie "Erwachsene doppelt".
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list.isError ? (
          <QueryError onRetry={() => list.refetch()} />
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Quelle (wird gelöscht)</span>
              <select
                className={selectClass}
                value={fromArt}
                onChange={(e) => setFromArt(e.target.value)}
                disabled={list.isLoading}
              >
                <option value="">Bitte wählen…</option>
                {rows.map((r) => (
                  <option key={r.art} value={r.art}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Ziel (bleibt erhalten)</span>
              <select
                className={selectClass}
                value={toArt}
                onChange={(e) => setToArt(e.target.value)}
                disabled={list.isLoading}
              >
                <option value="">Bitte wählen…</option>
                {rows
                  .filter((r) => String(r.art) !== fromArt)
                  .map((r) => (
                    <option key={r.art} value={r.art}>
                      {label(r)}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!valid}
              onClick={() => setConfirmOpen(true)}
              className="self-start"
            >
              <GitMerge className="size-4" /> Zusammenführen
            </Button>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !merge.isPending && setConfirmOpen(o)}
        title="Beitragsart zusammenführen?"
        description={
          fromRow && toRow
            ? `Alle ${fromRow.contractCount} Vertrag/Verträge der Beitragsart ${fromRow.art} (${fromRow.bezeichnung ?? "ohne Name"}) werden auf ${toRow.art} (${toRow.bezeichnung ?? "ohne Name"}) umgestellt. Anschließend wird ${fromRow.art} gelöscht. Das lässt sich nicht rückgängig machen.`
            : undefined
        }
        confirmLabel="Zusammenführen"
        destructive
        loading={merge.isPending}
        onConfirm={() => merge.mutate()}
      />
    </Card>
  );
}

function AbteilungMergeCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["abteilungen.list"], queryFn: () => orpc.abteilungen.list() });
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const merge = useMutation({
    mutationFn: () => orpc.abteilungen.merge({ fromId, toId }),
    onSuccess: (r) => {
      toast.success("Abteilung zusammengeführt.", {
        description: `${r.reassigned} Mitgliedschaft(en) von "${r.fromName}" nach "${r.toName}" verschoben.`,
      });
      setConfirmOpen(false);
      setFromId("");
      setToId("");
      qc.invalidateQueries({ queryKey: ["abteilungen.list"] });
      qc.invalidateQueries({ queryKey: ["dataQuality.summary"] });
    },
    onError: (e: Error) => toast.error("Zusammenführen fehlgeschlagen", { description: e.message }),
  });

  const rows = list.data ?? [];
  const valid = fromId !== "" && toId !== "" && fromId !== toId;
  const fromRow = rows.find((r) => r.id === fromId);
  const toRow = rows.find((r) => r.id === toId);
  const label = (r: (typeof rows)[number]) => `${r.name} (${r.totalCount} Mitgliedschaften)`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="size-4 text-muted-foreground" /> Abteilung zusammenführen
        </CardTitle>
        <CardDescription>
          Verschiebt alle Mitgliedschaften der Quelle auf das Ziel und löscht die Quelle. Für
          doppelt angelegte Sparten.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list.isError ? (
          <QueryError onRetry={() => list.refetch()} />
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Quelle (wird gelöscht)</span>
              <select
                className={selectClass}
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                disabled={list.isLoading}
              >
                <option value="">Bitte wählen…</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Ziel (bleibt erhalten)</span>
              <select
                className={selectClass}
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                disabled={list.isLoading}
              >
                <option value="">Bitte wählen…</option>
                {rows
                  .filter((r) => r.id !== fromId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {label(r)}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!valid}
              onClick={() => setConfirmOpen(true)}
              className="self-start"
            >
              <GitMerge className="size-4" /> Zusammenführen
            </Button>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !merge.isPending && setConfirmOpen(o)}
        title="Abteilung zusammenführen?"
        description={
          fromRow && toRow
            ? `Alle ${fromRow.totalCount} Mitgliedschaft(en) von "${fromRow.name}" werden nach "${toRow.name}" verschoben. Anschließend wird "${fromRow.name}" gelöscht. Das lässt sich nicht rückgängig machen.`
            : undefined
        }
        confirmLabel="Zusammenführen"
        destructive
        loading={merge.isPending}
        onConfirm={() => merge.mutate()}
      />
    </Card>
  );
}

function CategorySection({
  id,
  label,
  description,
  severity,
  count,
  open,
  onToggle,
}: {
  id: CategoryId;
  label: string;
  description: string;
  severity: "warn" | "info";
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const empty = count === 0;
  return (
    <Card className={cn(empty && "opacity-60")}>
      <button
        type="button"
        onClick={onToggle}
        disabled={empty}
        className="flex w-full items-center gap-3 p-4 text-left disabled:cursor-default"
      >
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            empty && "invisible",
          )}
        />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium tracking-tight">{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        <Badge variant={empty ? "outline" : severity === "warn" ? "warning" : "default"}>
          {count}
        </Badge>
      </button>
      {open && !empty ? <CategoryList id={id} /> : null}
    </Card>
  );
}

function CategoryList({ id }: { id: CategoryId }) {
  const list = useQuery({
    queryKey: ["dataQuality.list", id],
    queryFn: () => orpc.dataQuality.list({ category: id }),
  });

  if (list.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Lade Mitglieder…
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="border-t border-border p-4">
        <QueryError onRetry={() => list.refetch()} />
      </div>
    );
  }
  const items = list.data?.items ?? [];
  return (
    <div className="border-t border-border">
      <ul className="divide-y divide-border text-sm">
        {items.map((m) => (
          <li key={m.id}>
            <Link
              to="/app/mitglieder/$mitgliedsnummer"
              params={{ mitgliedsnummer: m.reference }}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
            >
              <span className="tabular-nums text-xs text-muted-foreground">{m.reference}</span>
              <span className="flex-1 truncate font-medium">{m.name}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                {detailFor(id, m)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {list.data?.capped ? (
        <div className="px-4 py-2 text-xs text-muted-foreground">
          Nur die ersten {items.length} Einträge werden angezeigt.
        </div>
      ) : null}
    </div>
  );
}

type ListItem = {
  ort: string | null;
  email: string | null;
  geburtsdatum: string | Date | null;
  austritt: string | Date | null;
};

/** A small context line per row, tuned to what the category is about. */
function detailFor(id: CategoryId, m: ListItem): string {
  switch (id) {
    case "fehlende_email":
    case "name_fehlt":
    case "aktiv_ohne_vertrag":
    case "mahnsperre_gesetzt":
    case "geschlecht_unbekannt":
    case "plz_ungueltig":
      return m.ort ?? "";
    case "fehlende_adresse":
    case "email_mehrfach":
    case "email_ungueltig":
      return m.email ?? "";
    case "minderjaehrig_ohne_vertretung":
    case "geburtsdatum_unplausibel":
    case "moegliche_dubletten":
      return m.geburtsdatum ? `geb. ${formatDate(m.geburtsdatum)}` : "";
    case "eintritt_nach_austritt":
    case "austritt_offene_vertraege":
      return m.austritt ? `Austritt ${formatDate(m.austritt)}` : "";
    default:
      return m.ort ?? "";
  }
}
