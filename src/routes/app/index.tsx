import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Cake, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import {
  AgePyramid,
  AreaChart,
  ChartLegend,
  DonutChart,
  GroupedBarChart,
  HorizontalBars,
  PALETTE,
} from "~/components/charts";
import { PageHeader } from "~/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { Skeleton } from "~/components/ui/skeleton";
import { formatCurrency, formatDate } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

const GENDER_COLORS: Record<string, string> = {
  männlich: PALETTE.sky,
  weiblich: PALETTE.rose,
  divers: PALETTE.amber,
  unbekannt: PALETTE.slate,
};

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard.stats"],
    queryFn: () => orpc.dashboard.stats(),
  });
  const insights = useQuery({
    queryKey: ["dashboard.insights"],
    queryFn: () => orpc.dashboard.insights(),
  });

  if (isError) {
    return (
      <QueryError
        title="Übersicht konnte nicht geladen werden"
        description="Die Kennzahlen konnten nicht abgerufen werden."
        error={error}
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading || !data) {
    return <DashboardSkeleton />;
  }

  const cards = [
    {
      label: "Mitglieder gesamt",
      value: data.total,
      icon: <Users className="size-5" />,
      tone: "primary",
    },
    {
      label: "Aktive Mitglieder",
      value: data.aktiv,
      icon: <UserCheck className="size-5" />,
      tone: "success",
    },
    {
      label: "Neue im Monat",
      value: data.newThisMonth,
      icon: <UserPlus className="size-5" />,
      tone: "info",
    },
    {
      label: "Austritte im Monat",
      value: data.austritteThisMonth,
      icon: <UserMinus className="size-5" />,
      tone: "warning",
    },
  ] as const;

  const maxPerAbt = Math.max(1, ...data.perAbteilung.map((p) => p.c));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Übersicht" description="Mitgliederstand und Aktivität auf einen Blick." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Altersstruktur</CardTitle>
            <CardDescription>Aktive Mitglieder nach Altersgruppe und Geschlecht.</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.data ? (
              <AgePyramid
                rows={insights.data.agePyramid.map((r) => ({
                  bucket: r.bucket,
                  left: r.m,
                  right: r.w,
                }))}
                left={{ label: "männlich", color: PALETTE.sky }}
                right={{ label: "weiblich", color: PALETTE.rose }}
              />
            ) : (
              <BarList rows={data.ageBuckets.map((b) => ({ label: b.bucket, value: b.c }))} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Geschlecht</CardTitle>
            <CardDescription>Aktive Mitglieder nach hinterlegtem Geschlecht.</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart
              centerLabel="Mitglieder"
              segments={data.gender.map((g) => ({
                label: g.gender,
                value: g.c,
                color: GENDER_COLORS[g.gender] ?? PALETTE.slate,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mitglieder je Abteilung</CardTitle>
            <CardDescription>Verteilung der aktiven Mitglieder über Sparten.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.perAbteilung.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Abteilungen vorhanden.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.perAbteilung.map((p) => (
                  <li key={p.name} className="flex items-center gap-3 sm:gap-4">
                    <span className="w-28 shrink-0 truncate text-sm font-medium sm:w-44">
                      {p.name}
                    </span>
                    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${(p.c / maxPerAbt) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {p.c}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mitgliedsdauer</CardTitle>
            <CardDescription>Wie lange sind die aktiven Mitglieder schon dabei.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList rows={data.tenure.map((t) => ({ label: t.bucket, value: t.c }))} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-1 pt-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <BarChart3 className="size-5 text-brand" /> Auswertungen
        </h2>
        <p className="text-sm text-muted-foreground">
          Entwicklung und Finanzen im Zeitverlauf. Werte werden kurz zwischengespeichert.
        </p>
      </div>

      {insights.isError ? (
        <QueryError
          title="Auswertungen konnten nicht geladen werden"
          onRetry={() => insights.refetch()}
        />
      ) : !insights.data ? (
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Mitgliederentwicklung</CardTitle>
              <CardDescription>Aktive Mitglieder zum Jahresende, letzte 10 Jahre.</CardDescription>
            </CardHeader>
            <CardContent>
              <AreaChart
                data={insights.data.membersOverTime.map((r) => ({
                  label: String(r.year),
                  value: r.aktiv,
                }))}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Eintritte und Austritte</CardTitle>
                <CardDescription>Zugänge und Abgänge pro Jahr.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ChartLegend
                  items={[
                    { label: "Eintritte", color: PALETTE.emerald },
                    { label: "Austritte", color: PALETTE.rose },
                  ]}
                />
                <GroupedBarChart
                  categories={insights.data.membersOverTime.map((r) => String(r.year))}
                  series={[
                    {
                      name: "Eintritte",
                      color: PALETTE.emerald,
                      values: insights.data.membersOverTime.map((r) => r.eintritte),
                    },
                    {
                      name: "Austritte",
                      color: PALETTE.rose,
                      values: insights.data.membersOverTime.map((r) => r.austritte),
                    },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Beitragsvolumen</CardTitle>
                <CardDescription>Soll und Bezahlt je Beitragsjahr.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {insights.data.revenueByYear.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Noch keine Beitragsläufe erfasst.
                  </p>
                ) : (
                  <>
                    <ChartLegend
                      items={[
                        { label: "Soll", color: PALETTE.indigo },
                        { label: "Bezahlt", color: PALETTE.emerald },
                      ]}
                    />
                    <GroupedBarChart
                      categories={insights.data.revenueByYear.map((r) => String(r.year))}
                      valueFormat={(n) => formatCurrency(n)}
                      series={[
                        {
                          name: "Soll",
                          color: PALETTE.indigo,
                          values: insights.data.revenueByYear.map((r) => r.soll),
                        },
                        {
                          name: "Bezahlt",
                          color: PALETTE.emerald,
                          values: insights.data.revenueByYear.map((r) => r.bezahlt),
                        },
                      ]}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Zahlart</CardTitle>
                <CardDescription>Aktive Mitglieder nach Zahlungsweg.</CardDescription>
              </CardHeader>
              <CardContent>
                <DonutChart
                  centerLabel="Zahler"
                  segments={[
                    {
                      label: "Lastschrift",
                      value: insights.data.zahlart.lastschrift,
                      color: PALETTE.indigo,
                    },
                    {
                      label: "Rechnung",
                      value: insights.data.zahlart.rechnung,
                      color: PALETTE.amber,
                    },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Offene Posten nach Mahnstufe</CardTitle>
                <CardDescription>
                  Dunnbare Sollstellungen, gruppiert nach Mahnstufe.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {insights.data.dunningFunnel.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Keine offenen Posten.
                  </p>
                ) : (
                  <HorizontalBars
                    rows={insights.data.dunningFunnel.map((f) => ({
                      label: f.mahnstufe === 0 ? "Noch nicht gemahnt" : `Mahnstufe ${f.mahnstufe}`,
                      value: f.anzahl,
                      hint: `${f.anzahl} · ${formatCurrency(f.offen)}`,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cake className="size-5 text-brand" /> Geburtstage in den nächsten 30 Tagen
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.birthdays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Geburtstage in den nächsten Tagen.
            </p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {data.birthdays.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <Link
                    to="/app/mitglieder/$mitgliedsnummer"
                    params={{ mitgliedsnummer: memberRef(b) }}
                    className="hover:underline"
                  >
                    {[b.vorname, b.nachname].filter(Boolean).join(" ") || `#${memberRef(b)}`}
                  </Link>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDate(b.nextBirthday)} · wird {b.turns}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BarList({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Daten.</p>;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3 sm:gap-4">
          <span className="w-20 shrink-0 truncate text-sm font-medium capitalize sm:w-28">
            {r.label}
          </span>
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/80 transition-[width] duration-500"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {r.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between p-5">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
              <Skeleton className="size-10 rounded-xl" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((card) => (
          <Card key={card}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-2.5 flex-1 rounded-full" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

type Tone = "primary" | "success" | "info" | "warning";

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: Tone;
}) {
  const ring: Record<Tone, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    info: "bg-foreground/5 text-foreground",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex items-center justify-between p-5 pt-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        </div>
        <div className={`flex size-10 items-center justify-center rounded-xl ${ring[tone]}`}>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
