import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ExternalLink,
  FileText,
  Inbox,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { toast } from "~/components/ui/toaster";
import { formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/forderungen/")({
  component: ForderungenPage,
});

function ForderungenPage() {
  const qc = useQueryClient();
  const [stufeFilter, setStufeFilter] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const open = useQuery({
    queryKey: ["dunning.open", stufeFilter],
    queryFn: () => orpc.dunning.open({ mahnstufe: stufeFilter, minDaysOverdue: 0 }),
  });

  const markPaid = useMutation({
    mutationFn: (sollStellungIds: string[]) => orpc.dunning.markPaid({ sollStellungIds }),
    onSuccess: (r) => {
      toast.success(`${r.count} Posten als bezahlt markiert.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
    },
    onError: (e: Error) => toast.error("Konnte nicht aktualisiert werden", { description: e.message }),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totals = open.data?.totals;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Forderungen</h1>
          <p className="text-sm text-muted-foreground">
            Offene Sollstellungen aller Mitglieder. Filter nach Mahnstufe und SEPA-Rückläufer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/forderungen/ruecklaeufer">
            <Button variant="outline" size="sm">
              <Banknote className="size-4" />
              Rückläufer
            </Button>
          </Link>
          <Link to="/app/forderungen/mahnungen">
            <Button variant="outline" size="sm">
              <FileText className="size-4" />
              Mahnläufe
            </Button>
          </Link>
          <Link to="/app/forderungen/mahnungen/neu">
            <Button size="sm">Neue Mahnungen</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Mitglieder mit Forderungen"
          value={totals?.members ?? 0}
          icon={<Inbox className="size-5" />}
          tone="primary"
          loading={open.isLoading}
        />
        <StatCard
          label="Offene Posten"
          value={totals?.postings ?? 0}
          icon={<FileText className="size-5" />}
          tone="info"
          loading={open.isLoading}
        />
        <StatCard
          label="Offene Summe"
          value={totals ? formatCurrency(totals.openSum) : "—"}
          icon={<Banknote className="size-5" />}
          tone="success"
          loading={open.isLoading}
        />
        <StatCard
          label="2. Mahnung fällig"
          value={(totals?.byStufe?.[2] ?? 0) + (totals?.byStufe?.[3] ?? 0)}
          icon={<AlertTriangle className="size-5" />}
          tone="warning"
          loading={open.isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Offene Posten</CardTitle>
          <div className="flex flex-wrap gap-1">
            <FilterChip
              label="Alle"
              active={stufeFilter === null}
              onClick={() => setStufeFilter(null)}
            />
            <FilterChip
              label="Noch nicht gemahnt"
              active={stufeFilter === 0}
              onClick={() => setStufeFilter(0)}
            />
            <FilterChip
              label="1. Erinnerung"
              active={stufeFilter === 1}
              onClick={() => setStufeFilter(1)}
            />
            <FilterChip
              label="1. Mahnung"
              active={stufeFilter === 2}
              onClick={() => setStufeFilter(2)}
            />
            <FilterChip
              label="2. Mahnung"
              active={stufeFilter === 3}
              onClick={() => setStufeFilter(3)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {open.isLoading ? (
            <p className="text-sm text-muted-foreground">Wird geladen...</p>
          ) : !open.data || open.data.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine offenen Posten für diesen Filter. Schön.
            </p>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between border-b pb-3">
                <p className="text-xs text-muted-foreground">
                  {open.data.members.length} Mitglied(er), {totals?.postings} Posten.
                </p>
                {selected.size > 0 ? (
                  <Button
                    size="sm"
                    onClick={() => markPaid.mutate([...selected])}
                    disabled={markPaid.isPending}
                  >
                    <CheckCircle2 className="size-4" />
                    {selected.size} als bezahlt markieren
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y">
                {open.data.members.map((m) => (
                  <li key={m.memberId} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/app/mitglieder/$mitgliedsnummer"
                            params={{ mitgliedsnummer: m.mitglnr ?? String(m.adrNr) }}
                            className="font-medium hover:underline"
                          >
                            {[m.vorname, m.nachname].filter(Boolean).join(" ") ||
                              m.kurzname ||
                              m.firma1 ||
                              `AdrNr ${m.adrNr}`}
                          </Link>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            #{m.mitglnr ?? m.adrNr}
                          </span>
                          <MahnstufeBadge stufe={m.currentMahnstufe} />
                          {m.mahnSperre && m.mahnSperre !== "" && m.mahnSperre !== "0" ? (
                            <Badge variant="destructive">
                              <ShieldAlert className="size-3" /> Mahnsperre
                            </Badge>
                          ) : null}
                          {m.daysOverdueMax >= 30 ? (
                            <Badge variant="warning">{m.daysOverdueMax} Tage überfällig</Badge>
                          ) : null}
                        </div>
                        <ul className="mt-1 space-y-1 text-xs">
                          {m.postings.map((p) => (
                            <li
                              key={p.sollStellungId}
                              className="flex items-center gap-2 text-muted-foreground"
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(p.sollStellungId)}
                                onChange={() => toggle(p.sollStellungId)}
                                className="size-3.5 rounded border-input"
                                aria-label="Auswählen"
                              />
                              <span className="tabular-nums">{p.billingYear}</span>
                              <span>fällig {formatDate(p.falligkeitsdatum)}</span>
                              <span className="tabular-nums">
                                {formatCurrency(p.openAmount)}
                              </span>
                              {Number(p.rueckgebuhr) > 0 ? (
                                <span className="tabular-nums text-warning">
                                  + {formatCurrency(p.rueckgebuhr)} R-Geb.
                                </span>
                              ) : null}
                              {p.status === "returned" ? (
                                <Badge variant="warning">Rückläufer</Badge>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-lg font-semibold tabular-nums">
                          {formatCurrency(m.openSum)}
                        </span>
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: m.mitglnr ?? String(m.adrNr) }}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                        >
                          Mitglied <ExternalLink className="size-3" />
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MahnstufeBadge({ stufe }: { stufe: number }) {
  if (stufe <= 0) return null;
  const label = stufe === 1 ? "1. Erinnerung" : stufe === 2 ? "1. Mahnung" : "2. Mahnung";
  const variant = stufe === 1 ? "info" : stufe === 2 ? "warning" : "destructive";
  return <Badge variant={variant}>{label}</Badge>;
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

type Tone = "primary" | "success" | "info" | "warning";

function StatCard({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: Tone;
  loading?: boolean;
}) {
  const ring: Record<Tone, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    info: "bg-foreground/5 text-foreground",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex items-center justify-between p-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {loading ? "…" : value}
          </span>
        </div>
        <div className={`flex size-10 items-center justify-center rounded-xl ${ring[tone]}`}>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
