import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
    return <div className="text-muted-foreground">Wird geladen...</div>;
  }

  const cards = [
    { label: "Mitglieder gesamt", value: data.total, icon: <Users className="size-5" /> },
    { label: "Aktive Mitglieder", value: data.aktiv, icon: <UserCheck className="size-5" /> },
    { label: "Neue Mitglieder im Monat", value: data.newThisMonth, icon: <UserPlus className="size-5" /> },
    { label: "Austritte im Monat", value: data.austritteThisMonth, icon: <UserMinus className="size-5" /> },
  ];
  const maxPerAbt = Math.max(1, ...data.perAbteilung.map((p) => p.c));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Übersicht über Mitgliederstand und Aktivität.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <div className="text-muted-foreground">{c.icon}</div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Mitglieder je Abteilung</CardTitle>
        </CardHeader>
        <CardContent>
          {data.perAbteilung.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Abteilungen vorhanden.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.perAbteilung.map((p) => (
                <li key={p.name} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm">{p.name}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(p.c / maxPerAbt) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm tabular-nums">{p.c}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
