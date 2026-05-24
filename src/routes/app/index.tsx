import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard.stats"],
    queryFn: () => orpc.dashboard.stats(),
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Wird geladen…
      </div>
    );
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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Übersicht über Mitgliederstand und Aktivität.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
        ))}
      </div>

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
                <li key={p.name} className="flex items-center gap-4">
                  <span className="w-44 truncate text-sm font-medium">{p.name}</span>
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${(p.c / maxPerAbt) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
                    {p.c}
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
