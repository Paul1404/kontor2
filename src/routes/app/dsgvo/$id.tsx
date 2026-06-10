import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileLock2,
  Hash,
  Loader2,
  Save,
  User,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/dsgvo/$id")({
  component: DsgvoDetailPage,
});

const STATUS_OPTIONS = [
  { value: "open", label: "Offen" },
  { value: "in_progress", label: "In Bearbeitung" },
  { value: "completed", label: "Erledigt" },
  { value: "rejected", label: "Abgelehnt" },
] as const;
type RequestStatus = (typeof STATUS_OPTIONS)[number]["value"];

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
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dsgvo.get", id],
    queryFn: () => orpc.dsgvo.getRequest({ id }),
  });

  const [status, setStatus] = useState<RequestStatus>("open");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!data) return;
    setStatus(data.status as RequestStatus);
    setNotes(data.notes ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: () => orpc.dsgvo.updateRequestStatus({ id, status, notes: notes.trim() || null }),
    onSuccess: () => {
      toast.success("Gespeichert.");
      qc.invalidateQueries({ queryKey: ["dsgvo.get", id] });
      qc.invalidateQueries({ queryKey: ["dsgvo.list"] });
    },
    onError: (e: Error) => toast.error("Speichern fehlgeschlagen", { description: e.message }),
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
                params={{
                  mitgliedsnummer: data.memberMitglnr ?? String(data.memberAdrNr ?? data.memberId),
                }}
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
          {data.docRef ? (
            <Field icon={<Hash className="size-4" />} label="Dokument">
              <span className="font-mono text-xs">{data.docRef}</span>
            </Field>
          ) : null}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Save className="size-5 text-muted-foreground" /> Bearbeitung
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Label className="flex flex-col gap-1.5 sm:max-w-xs">
            <span>Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as RequestStatus)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Label>
          <Label className="flex flex-col gap-1.5">
            <span>Notizen</span>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </Label>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Speichern
          </Button>
        </CardContent>
      </Card>

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
