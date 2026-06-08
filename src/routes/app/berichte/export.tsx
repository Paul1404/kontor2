import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileDown, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { toast } from "~/components/ui/toaster";
import { triggerDownload } from "~/lib/download";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/export")({
  component: ExportCenterPage,
});

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const STATUS_OPTIONS = [
  { value: "aktiv", label: "Aktive" },
  { value: "passiv", label: "Passive" },
  { value: "ausgetreten", label: "Ausgetretene" },
  { value: "alle", label: "Alle" },
] as const;

function ExportCenterPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [status, setStatus] = useState<"aktiv" | "passiv" | "ausgetreten" | "alle">("aktiv");
  const [abteilungId, setAbteilungId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const abteilungen = useQuery({
    queryKey: ["reports.abteilungen"],
    queryFn: () => orpc.reports.abteilungenList(),
  });

  async function run(key: string, fn: () => Promise<{ filename: string; content: string }>) {
    setBusy(key);
    try {
      const res = await fn();
      triggerDownload(res.filename, res.content, "text/csv;charset=utf-8");
      toast.success("Export erstellt", { description: res.filename });
    } catch (e) {
      toast.error("Export fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  }

  const years = Array.from({ length: 12 }, (_, i) => now.getUTCFullYear() - i);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileDown className="size-6 text-brand" /> Export-Center
        </h1>
        <p className="text-sm text-muted-foreground">
          Alle Auswertungen als CSV an einem Ort. Die Dateien öffnen sich direkt in Excel oder
          LibreOffice.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExportCard
          title="Mitgliederliste"
          description="Stammdaten der Mitglieder, gefiltert nach Status und Abteilung."
          busy={busy === "members"}
          onDownload={() =>
            run("members", () =>
              orpc.reports.membersExport({
                status,
                abteilungId: abteilungId || null,
                includeAusgetretene: status === "alle",
              }),
            )
          }
        >
          <Field label="Status">
            <Select value={status} onChange={(v) => setStatus(v as typeof status)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Abteilung">
            <Select value={abteilungId} onChange={setAbteilungId}>
              <option value="">Alle</option>
              {(abteilungen.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </ExportCard>

        <ExportCard
          title="Geburtstage"
          description="Mitglieder mit Geburtstag im gewählten Monat."
          busy={busy === "geburtstage"}
          onDownload={() =>
            run("geburtstage", () => orpc.reports.geburtstageExport({ month, year }))
          }
        >
          <Field label="Monat">
            <Select value={String(month)} onChange={(v) => setMonth(Number(v))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Jahr">
            <Select value={String(year)} onChange={(v) => setYear(Number(v))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </ExportCard>

        <ExportCard
          title="Ehrungen"
          description="Jubilare des Jahres (25, 40, 50, 60, 70, 75 Jahre)."
          busy={busy === "ehrungen"}
          onDownload={() => run("ehrungen", () => orpc.reports.ehrungenExport({ year }))}
        >
          <Field label="Jahr">
            <Select value={String(year)} onChange={(v) => setYear(Number(v))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </ExportCard>

        <ExportCard
          title="Abteilungs-Statistik"
          description="Aktive, Eintritte und Austritte je Abteilung im Jahr."
          busy={busy === "abteilung"}
          onDownload={() => run("abteilung", () => orpc.reports.abteilungStatsExport({ year }))}
        >
          <Field label="Jahr">
            <Select value={String(year)} onChange={(v) => setYear(Number(v))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </ExportCard>

        <ExportCard
          title="Finanzbericht"
          description="Soll, Bezahlt und Offen je Beitragsjahr, nach Abteilung und Beitragsart."
          busy={busy === "finanzen"}
          onDownload={() => run("finanzen", () => orpc.reports.finanzberichtExport({ year }))}
        >
          <Field label="Beitragsjahr">
            <Select value={String(year)} onChange={(v) => setYear(Number(v))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </ExportCard>
      </div>
    </div>
  );
}

function ExportCard({
  title,
  description,
  busy,
  onDownload,
  children,
}: {
  title: string;
  description: string;
  busy: boolean;
  onDownload: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex flex-wrap items-end gap-3">{children}</div>
        <div>
          <Button type="button" onClick={onDownload} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            CSV herunterladen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {children}
    </select>
  );
}
