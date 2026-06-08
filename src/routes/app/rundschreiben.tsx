import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Mails, Send, TestTube2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";
import { MERGE_FIELDS, renderTemplate, SAMPLE_VARS } from "~/lib/rundschreiben";

export const Route = createFileRoute("/app/rundschreiben")({
  component: RundschreibenPage,
});

type StatusFilter = "lebende" | "aktiv" | "passiv" | "alle";

const STATUS_LABELS: Record<StatusFilter, string> = {
  lebende: "Aktive und passive Mitglieder",
  aktiv: "Nur aktive Mitglieder",
  passiv: "Nur passive Mitglieder",
  alle: "Alle (inkl. ausgetretene und verstorbene)",
};

const DEFAULT_BODY = `Hallo {{vorname}},

`;

function RundschreibenPage() {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [status, setStatus] = useState<StatusFilter>("lebende");
  const [abteilungId, setAbteilungId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filter = useMemo(
    () => ({ status, abteilungId: abteilungId || null }),
    [status, abteilungId],
  );

  const abteilungen = useQuery({
    queryKey: ["abteilungen.list"],
    queryFn: () => orpc.abteilungen.list(),
  });
  const preview = useQuery({
    queryKey: ["rundschreiben.preview", status, abteilungId],
    queryFn: () => orpc.rundschreiben.preview({ filter }),
  });
  const history = useQuery({
    queryKey: ["rundschreiben.list"],
    queryFn: () => orpc.rundschreiben.list(),
  });

  const sendTest = useMutation({
    mutationFn: () => orpc.rundschreiben.sendTest({ subject, body }),
    onSuccess: (r) => toast.success(`Testmail an ${r.to} gesendet.`),
    onError: (e: Error) => toast.error("Testmail fehlgeschlagen", { description: e.message }),
  });

  const send = useMutation({
    mutationFn: () => orpc.rundschreiben.send({ subject, body, filter }),
    onSuccess: async (r) => {
      setConfirmOpen(false);
      toast.success(
        `Rundschreiben versendet: ${r.sent} zugestellt${r.failed > 0 ? `, ${r.failed} fehlgeschlagen` : ""}.`,
      );
      await qc.invalidateQueries({ queryKey: ["rundschreiben.list"] });
    },
    onError: (e: Error) => {
      setConfirmOpen(false);
      toast.error("Versand fehlgeschlagen", { description: e.message });
    },
  });

  const downloadPostal = useMutation({
    mutationFn: () => orpc.rundschreiben.postalList({ filter }),
    onSuccess: (rows) => {
      if (rows.length === 0) {
        toast.info("Keine Mitglieder ohne E-Mail im Segment.");
        return;
      }
      const header = ["Referenz", "Name", "Anrede", "Straße", "PLZ", "Ort"];
      const csv = [
        header.join(";"),
        ...rows.map((r) =>
          [r.reference, r.name, r.anrede ?? "", r.strasse, r.plz ?? "", r.ort ?? ""]
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(";"),
        ),
      ].join("\r\n");
      const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "postanschriften.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e: Error) => toast.error("Export fehlgeschlagen", { description: e.message }),
  });

  const canSend = subject.trim().length > 0 && body.trim().length > 0;
  const reach = preview.data?.withEmail ?? 0;
  const previewBody = renderTemplate(body || "", SAMPLE_VARS);
  const previewSubject = renderTemplate(subject || "", SAMPLE_VARS);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Mails className="size-6 text-brand" /> Rundschreiben
        </h1>
        <p className="text-sm text-muted-foreground">
          Eine E-Mail an ein ganzes Segment. Platzhalter werden pro Mitglied ersetzt. Mitglieder
          ohne E-Mail erreichst du per Serienbrief über den Adress-Export.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Nachricht</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-subject">Betreff</Label>
                <Input
                  id="rs-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="z. B. Einladung zur Jahreshauptversammlung"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-body">Text</Label>
                <Textarea
                  id="rs-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Platzhalter einfügen
                </span>
                <div className="flex flex-wrap gap-2">
                  {MERGE_FIELDS.map((f) => (
                    <button
                      key={f.token}
                      type="button"
                      onClick={() => setBody((b) => `${b}${f.token}`)}
                      className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
                      title={`${f.label} einfügen`}
                    >
                      {f.token}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vorschau</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Beispielempfänger: {SAMPLE_VARS.name}
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="border-b border-border pb-2 text-sm font-semibold">
                  {previewSubject || <span className="text-muted-foreground">Kein Betreff</span>}
                </div>
                <div className="whitespace-pre-wrap pt-3 text-sm">
                  {previewBody || <span className="text-muted-foreground">Kein Text</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4" /> Empfänger
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-status">Segment</Label>
                <select
                  id="rs-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rs-abt">Abteilung</Label>
                <select
                  id="rs-abt"
                  value={abteilungId}
                  onChange={(e) => setAbteilungId(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="">Alle Abteilungen</option>
                  {(abteilungen.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                {preview.isLoading ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Ermittle Empfänger…
                  </span>
                ) : preview.isError ? (
                  <QueryError onRetry={() => preview.refetch()} />
                ) : preview.data ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Per E-Mail erreichbar</span>
                      <span className="font-semibold tabular-nums">{preview.data.withEmail}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Nur per Post</span>
                      <span className="font-semibold tabular-nums">
                        {preview.data.withoutEmail}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
                      <span className="text-muted-foreground">Segment gesamt</span>
                      <span className="font-semibold tabular-nums">{preview.data.total}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => sendTest.mutate()}
                  disabled={!canSend || sendTest.isPending}
                >
                  {sendTest.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <TestTube2 className="size-4" />
                  )}
                  Test an mich senden
                </Button>
                <Button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canSend || reach === 0 || send.isPending}
                >
                  {send.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  An {reach} Empfänger senden
                </Button>
                {(preview.data?.withoutEmail ?? 0) > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => downloadPostal.mutate()}
                    disabled={downloadPostal.isPending}
                  >
                    {downloadPostal.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Postanschriften ({preview.data?.withoutEmail}) als CSV
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verlauf</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Lade Verlauf…
            </span>
          ) : history.isError ? (
            <QueryError onRetry={() => history.refetch()} />
          ) : !history.data || history.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Rundschreiben versendet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Betreff</th>
                  <th className="py-1 pr-3 text-right">Empfänger</th>
                  <th className="py-1 pr-3 text-right">Zugestellt</th>
                  <th className="py-1 pr-3 text-right">Fehler</th>
                  <th className="py-1 pr-3">Gesendet</th>
                  <th className="py-1">Von</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{h.subject}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{h.recipientCount}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-success">
                      {h.sentCount}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {h.failedCount > 0 ? (
                        <span className="text-destructive">{h.failedCount}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">
                      {formatDateTime(h.createdAt)}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{h.createdByEmail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!send.isPending) setConfirmOpen(o);
        }}
        title="Rundschreiben senden"
        description={`Das Rundschreiben "${previewSubject || subject}" geht an ${reach} Mitglieder per E-Mail. Das lässt sich nicht zurücknehmen.`}
        confirmLabel="Jetzt senden"
        loading={send.isPending}
        onConfirm={() => send.mutate()}
      />
    </div>
  );
}
