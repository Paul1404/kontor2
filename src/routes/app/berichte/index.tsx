import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Cake, Coins, FileBarChart, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/")({
  component: BerichteOverviewPage,
});

type ReportCard = {
  to: string;
  title: string;
  description: string;
  icon: ReactNode;
  vorstandOnly?: boolean;
};

const CARDS: ReportCard[] = [
  {
    to: "/app/berichte/geburtstage",
    title: "Geburtstagsliste",
    description: "Mitglieder mit Geburtstag im gewählten Monat, runde Geburtstage hervorgehoben.",
    icon: <Cake className="size-6" />,
  },
  {
    to: "/app/berichte/ehrungen",
    title: "Ehrungen",
    description: "Jubilare des Jahres: 25, 40, 50, 60, 70, 75 Jahre Mitgliedschaft.",
    icon: <Trophy className="size-6" />,
  },
  {
    to: "/app/berichte/abteilungs-statistik",
    title: "Abteilungs-Statistik",
    description: "Aktive Mitglieder, Eintritte und Austritte je Abteilung im gewählten Jahr.",
    icon: <BarChart3 className="size-6" />,
    vorstandOnly: true,
  },
  {
    to: "/app/berichte/finanzen",
    title: "Finanzbericht",
    description:
      "Soll, Bezahlt und Offen je Beitragsjahr, aufgeschlüsselt nach Abteilung und Beitragsart.",
    icon: <Coins className="size-6" />,
    vorstandOnly: true,
  },
];

function BerichteOverviewPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const role = me.data?.role ?? "readonly";
  const visible = CARDS.filter((c) => !c.vorstandOnly || role === "vorstand" || role === "admin");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileBarChart className="size-6 text-brand" /> Berichte
        </h1>
        <p className="text-sm text-muted-foreground">
          Listen und Auswertungen. Jeder Bericht lässt sich als CSV exportieren oder direkt aus dem
          Browser drucken.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((c) => (
          <Link key={c.to} to={c.to} className="group">
            <Card className="h-full transition-all group-hover:border-brand/40 group-hover:shadow-card">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="rounded-lg bg-brand/10 p-2.5 text-brand">{c.icon}</div>
                <div className="flex flex-col gap-1">
                  <div className="font-semibold tracking-tight">{c.title}</div>
                  <div className="text-sm text-muted-foreground">{c.description}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
