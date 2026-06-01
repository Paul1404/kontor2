import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Calendar, CheckCircle2, FileLock2, Hash, User } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/dsgvo/$id")({
  component: DsgvoDetailPage,
});

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

function DsgvoDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["dsgvo.get", id],
    queryFn: () => orpc.dsgvo.getRequest({ id }),
  });

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground">Wird geladen…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/app/dsgvo"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Zur Übersicht
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileLock2 className="size-6 text-brand" />
          {TYPE_LABEL[data.type] ?? data.type}
        </h1>
        <p className="text-sm text-muted-foreground">
          Status: <span className="font-medium text-foreground">{STATUS_LABEL[data.status]}</span>
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field icon={<User className="size-4" />} label="Mitglied">
            {data.memberId ? (
              <Link
                to="/app/mitglieder/$mitgliedsnummer"
                params={{ mitgliedsnummer: data.memberMitglnr ?? data.memberId }}
                className="text-brand hover:underline"
              >
                {data.memberVorname} {data.memberNachname} #{data.memberMitglnr ?? "—"}
              </Link>
            ) : (
              <span className="text-muted-foreground">anonym</span>
            )}
          </Field>
          <Field icon={<Calendar className="size-4" />} label="Eingegangen">
            {formatDateTime(data.requestedAt)}
            {data.requestedByEmail ? (
              <span className="text-muted-foreground"> · {data.requestedByEmail}</span>
            ) : null}
          </Field>
          <Field icon={<Calendar className="size-4" />} label="Frist">
            {formatDateTime(data.deadline)}
          </Field>
          <Field icon={<CheckCircle2 className="size-4" />} label="Abgeschlossen">
            {data.completedAt ? formatDateTime(data.completedAt) : "—"}
          </Field>
          {data.deliverableSha256 ? (
            <Field icon={<Hash className="size-4" />} label="SHA-256">
              <span className="font-mono text-xs break-all">{data.deliverableSha256}</span>
            </Field>
          ) : null}
          {data.deliverableSizeBytes ? (
            <Field icon={<Hash className="size-4" />} label="Größe">
              {Math.round(Number(data.deliverableSizeBytes) / 1024)} KB
            </Field>
          ) : null}
        </CardContent>
      </Card>

      {data.notes ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Notizen
            </div>
            <div className="whitespace-pre-wrap text-sm">{data.notes}</div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Die ausgelieferte Datei wurde aus Datenschutzgründen nicht persistiert. Bei Bedarf kann
          eine neue Auskunft auf der Mitgliederseite erstellt werden. Der SHA-256 oben ist der
          deterministische Fingerprint des damals erzeugten Datensatzes; eine neue Auskunft erzeugt
          denselben Hash, solange sich keine Daten geändert haben.
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
