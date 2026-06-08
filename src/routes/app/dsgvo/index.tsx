import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, FileText, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { QueryErrorRow } from "~/components/ui/query-error";
import { formatDate, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/dsgvo/")({
  component: DsgvoIndexPage,
});

const STATUS_OPTIONS = [
  { value: null, label: "Alle" },
  { value: "open" as const, label: "Offen" },
  { value: "in_progress" as const, label: "In Bearbeitung" },
  { value: "completed" as const, label: "Erledigt" },
  { value: "rejected" as const, label: "Abgelehnt" },
];

const TYPE_LABEL: Record<string, string> = {
  auskunft: "Auskunft (Art. 15)",
  berichtigung: "Berichtigung (Art. 16)",
  loeschung: "Löschung (Art. 17)",
  einschraenkung: "Einschränkung (Art. 18)",
  widerspruch: "Widerspruch (Art. 21)",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  in_progress: "In Bearbeitung",
  completed: "Erledigt",
  rejected: "Abgelehnt",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: typeof CheckCircle2; tone: string }> = {
    open: {
      icon: Clock,
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    },
    in_progress: {
      icon: Clock,
      tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    },
    completed: {
      icon: CheckCircle2,
      tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    },
    rejected: {
      icon: XCircle,
      tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    },
  };
  const entry = map[status] ?? map.open!;
  const Icon = entry.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${entry.tone}`}
    >
      <Icon className="size-3" /> {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function DsgvoIndexPage() {
  const [status, setStatus] = useState<"open" | "in_progress" | "completed" | "rejected" | null>(
    null,
  );
  const list = useQuery({
    queryKey: ["dsgvo.list", { status }],
    queryFn: () => orpc.dsgvo.listRequests({ page: 1, pageSize: 100, status, type: null }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-6 text-brand" /> Datenschutz / DSGVO
        </h1>
        <p className="text-sm text-muted-foreground">
          Anfragen nach Art. 15 / 16 / 17 / 18 / 21 DSGVO. Auskünfte werden direkt auf der
          Mitgliederseite erstellt, Löschungen unter Berücksichtigung der Aufbewahrungsfristen.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {STATUS_OPTIONS.map((o) => (
            <button
              type="button"
              key={String(o.value)}
              onClick={() => setStatus(o.value ?? null)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                status === o.value
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {o.label}
            </button>
          ))}
          <div className="ml-auto text-xs text-muted-foreground">
            {list.data?.total ?? 0} Anfragen
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Typ</th>
                <th className="px-4 py-3 font-medium">Mitglied</th>
                <th className="px-4 py-3 font-medium">Eingang</th>
                <th className="px-4 py-3 font-medium">Frist</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Bearbeitet von</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.isError ? (
                <QueryErrorRow colSpan={6} onRetry={() => list.refetch()} />
              ) : list.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Wird geladen…
                  </td>
                </tr>
              ) : (list.data?.rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Keine Anfragen. Auskünfte werden auf der Mitgliederseite ausgelöst.
                  </td>
                </tr>
              ) : (
                list.data?.rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        to="/app/dsgvo/$id"
                        params={{ id: r.id }}
                        className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                      >
                        <FileText className="size-3.5" />
                        {TYPE_LABEL[r.type] ?? r.type}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.memberId ? (
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{
                            mitgliedsnummer: r.memberMitglnr ?? String(r.memberAdrNr ?? r.memberId),
                          }}
                          className="text-foreground hover:underline"
                        >
                          {r.memberVorname} {r.memberNachname}{" "}
                          <span className="text-muted-foreground">#{r.memberMitglnr ?? "—"}</span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">anonym</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(r.requestedAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {formatDate(r.deadline)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.requestedByEmail ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
