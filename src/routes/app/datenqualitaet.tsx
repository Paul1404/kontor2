import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ListChecks, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { cn } from "~/lib/cn";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/datenqualitaet")({
  component: DatenqualitaetPage,
});

type CategoryId =
  | "lastschrift_ohne_mandat"
  | "fehlende_iban"
  | "fehlende_email"
  | "fehlende_adresse"
  | "minderjaehrig_ohne_vertretung"
  | "vertrag_ohne_beitragsart"
  | "austritt_offene_vertraege"
  | "moegliche_dubletten";

function DatenqualitaetPage() {
  const summary = useQuery({
    queryKey: ["dataQuality.summary"],
    queryFn: () => orpc.dataQuality.summary(),
  });
  const [open, setOpen] = useState<CategoryId | null>(null);

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
        <div className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{summary.data.total}</span>{" "}
            offene Hinweise in {summary.data.categories.filter((c) => c.count > 0).length}{" "}
            Kategorien.
          </div>
          {summary.data.categories.map((c) => (
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
          ))}
        </div>
      ) : null}
    </div>
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
      return m.ort ?? "";
    case "fehlende_adresse":
      return m.email ?? "";
    case "minderjaehrig_ohne_vertretung":
      return m.geburtsdatum ? `geb. ${formatDate(m.geburtsdatum)}` : "";
    case "austritt_offene_vertraege":
      return m.austritt ? `Austritt ${formatDate(m.austritt)}` : "";
    case "moegliche_dubletten":
      return m.geburtsdatum ? `geb. ${formatDate(m.geburtsdatum)}` : "";
    default:
      return m.ort ?? "";
  }
}
