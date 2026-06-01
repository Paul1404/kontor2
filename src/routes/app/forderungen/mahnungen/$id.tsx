import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Download, Loader2, Mail, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import { formatCurrency, formatDate, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/forderungen/mahnungen/$id")({
  component: MahnungDetailPage,
});

function MahnungDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // The item currently queued for an email preview, or null when the dialog
  // is closed.
  const [emailItemId, setEmailItemId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["dunning.get", id],
    queryFn: () => orpc.dunning.get({ id }),
  });

  const cancel = useMutation({
    mutationFn: (reason: string | null) => orpc.dunning.cancel({ id, reason }),
    onSuccess: () => {
      toast.success("Mahnlauf storniert. Mahnstufen zurückgesetzt.");
      setCancelOpen(false);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["dunning.get", id] });
      qc.invalidateQueries({ queryKey: ["dunning.list"] });
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
    },
    onError: (e: Error) => toast.error("Konnte nicht storniert werden", { description: e.message }),
  });

  const markSent = useMutation({
    mutationFn: (opts: { itemId: string; channel: "email" | "letter"; sentTo: string | null }) =>
      orpc.dunning.markSent(opts),
    onSuccess: () => {
      toast.success("Als versendet markiert.");
      qc.invalidateQueries({ queryKey: ["dunning.get", id] });
    },
  });

  const emailPreview = useQuery({
    queryKey: ["dunning.emailPreview", emailItemId],
    queryFn: () => orpc.dunning.emailPreview({ itemId: emailItemId! }),
    enabled: !!emailItemId,
  });

  const sendEmail = useMutation({
    mutationFn: (itemId: string) => orpc.dunning.sendEmail({ itemId }),
    onSuccess: (r) => {
      toast.success(`E-Mail gesendet an ${r.to}.`);
      setEmailItemId(null);
      qc.invalidateQueries({ queryKey: ["dunning.get", id] });
    },
    onError: (e: Error) => toast.error("Versand fehlgeschlagen", { description: e.message }),
  });

  async function downloadPdf(itemId: string, filename: string) {
    try {
      const r = await orpc.dunning.downloadPdf({ itemId });
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename || filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download fehlgeschlagen", { description: (e as Error).message });
    }
  }

  if (detail.isLoading) {
    return <p className="text-sm text-muted-foreground">Wird geladen...</p>;
  }
  if (!detail.data) {
    return <p className="text-sm text-muted-foreground">Mahnlauf nicht gefunden.</p>;
  }
  const { run, items } = detail.data;
  const cancelled = run.status === "cancelled";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            to="/app/forderungen/mahnungen"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeft className="size-3" /> Mahnläufe
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {levelLabel(run.level)} · {formatDate(run.runDate)}
          </h1>
          {cancelled ? (
            <Badge variant="destructive">storniert</Badge>
          ) : (
            <Badge variant="success">aktiv</Badge>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <Stat label="Empfänger" value={`${run.itemCount}`} />
          <Stat label="Offene Summe" value={formatCurrency(run.totalOpen)} />
          <Stat label="Mahngebühren" value={formatCurrency(run.totalFees)} />
          <Stat label="Frist" value={formatDate(run.dueDate)} />
        </CardContent>
      </Card>

      {run.notes ? <p className="text-sm text-muted-foreground italic">{run.notes}</p> : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Mahnungen</CardTitle>
          {!cancelled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCancelOpen(true)}
              disabled={cancel.isPending}
            >
              <Trash2 className="size-4" /> Stornieren
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Empfänger.</p>
          ) : (
            <ul className="divide-y">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/app/mitglieder/$mitgliedsnummer"
                        params={{ mitgliedsnummer: i.mitglnr ?? String(i.adrNr) }}
                        className="font-medium hover:underline"
                      >
                        {i.memberName}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        #{i.mitglnr ?? i.adrNr}
                      </span>
                      <SentBadge channel={i.sentChannel} sentAt={i.sentAt} />
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      offen {formatCurrency(i.openSum)} · Gebühr {formatCurrency(i.mahngebuhr)} ·
                      gesamt {formatCurrency(i.totalDue)} · Frist {formatDate(i.dueDate)}
                    </p>
                    {i.sentTo ? (
                      <p className="text-xs text-muted-foreground">an {i.sentTo}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadPdf(i.id, i.pdfFilename ?? `Mahnung-${i.id}.pdf`)}
                  >
                    <Download className="size-4" /> PDF
                  </Button>
                  {i.sentChannel === "pending" && !cancelled ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEmailItemId(i.id)}
                        disabled={!i.recipientEmail}
                        title={
                          i.recipientEmail
                            ? `E-Mail an ${i.recipientEmail}${i.addressedToGuardian ? " (Vertretung)" : ""}`
                            : "Keine E-Mail hinterlegt"
                        }
                      >
                        <Mail className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          markSent.mutate({
                            itemId: i.id,
                            channel: "letter",
                            sentTo: "Brief",
                          })
                        }
                        disabled={markSent.isPending}
                        title="Als per Brief versendet markieren"
                      >
                        <CheckCircle2 className="size-4" />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => {
          if (!cancel.isPending) {
            setCancelOpen(o);
            if (!o) setCancelReason("");
          }
        }}
        title="Mahnlauf stornieren"
        description="Die Mahnstufe der betroffenen Posten wird auf die vorherige Stufe zurückgesetzt."
        confirmLabel="Stornieren"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(cancelReason.trim() || null)}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Grund (optional)</span>
          <Input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="z.B. versehentlich erstellt"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={emailItemId !== null}
        onOpenChange={(o) => {
          if (!sendEmail.isPending && !o) setEmailItemId(null);
        }}
        title="Mahnung per E-Mail senden"
        description="So wird die E-Mail mit dem angehängten PDF verschickt."
        confirmLabel="Jetzt senden"
        loading={sendEmail.isPending}
        onConfirm={() => emailItemId && sendEmail.mutate(emailItemId)}
      >
        {emailPreview.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Vorschau wird geladen...
          </div>
        ) : emailPreview.data ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground">An</span>
              <span className="break-all">{emailPreview.data.to}</span>
              <span className="text-muted-foreground">Betreff</span>
              <span>{emailPreview.data.subject}</span>
              <span className="text-muted-foreground">Anhang</span>
              <span className="break-all">{emailPreview.data.attachmentName}</span>
            </div>
            {emailPreview.data.addressedToGuardian ? (
              <p className="text-xs text-muted-foreground">
                Diese Mahnung geht an die gesetzliche Vertretung des Mitglieds.
              </p>
            ) : null}
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-card p-3 font-sans text-xs leading-relaxed">
              {emailPreview.data.body}
            </pre>
          </div>
        ) : (
          <span className="text-muted-foreground">Keine Vorschau verfügbar.</span>
        )}
      </ConfirmDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SentBadge({ channel, sentAt }: { channel: string; sentAt: string | Date | null }) {
  if (channel === "pending") return <Badge variant="warning">nicht versendet</Badge>;
  if (channel === "email")
    return (
      <Badge variant="info">
        <Mail className="size-3" /> E-Mail · {sentAt ? formatDateTime(sentAt) : ""}
      </Badge>
    );
  return <Badge variant="success">Brief · {sentAt ? formatDateTime(sentAt) : ""}</Badge>;
}

function levelLabel(l: number): string {
  if (l === 1) return "Erinnerung";
  if (l === 2) return "1. Mahnung";
  return "2. Mahnung";
}
