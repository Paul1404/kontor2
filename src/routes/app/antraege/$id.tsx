import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
  MailCheck,
  MailWarning,
  MailX,
  Save,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { Textarea } from "~/components/ui/textarea";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/antraege/$id")({
  component: AntragDetailPage,
});

function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE");
}

function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

const FILE_KIND_LABEL: Record<string, string> = {
  generated_pdf: "Beitrittserklärung (PDF)",
  signed_scan: "Unterschriebenes Dokument",
  approved_pdf: "Genehmigte Beitrittserklärung",
  signature_image: "Unterschriftsbild",
};

const EMAIL_KIND_LABEL: Record<string, string> = {
  antrag_confirmation: "Bestätigung an Antragsteller",
  antrag_club_notification: "Benachrichtigung an Verein",
  antrag_approval: "Genehmigung",
  antrag_decline: "Ablehnung",
};

type EmailStatusMeta = { label: string; cls: string; icon: typeof Mail };
const EMAIL_STATUS_SKIPPED: EmailStatusMeta = {
  label: "Übersprungen",
  cls: "text-muted-foreground",
  icon: MailWarning,
};
const EMAIL_STATUS: Record<string, EmailStatusMeta> = {
  sent: { label: "Versendet", cls: "text-success", icon: MailCheck },
  failed: { label: "Fehlgeschlagen", cls: "text-destructive", icon: MailX },
  skipped: EMAIL_STATUS_SKIPPED,
};

const EMAIL_DETAIL_LABEL: Record<string, string> = {
  smtp_not_configured: "Kein E-Mail-Versand eingerichtet",
  no_recipient: "Keine E-Mail-Adresse hinterlegt",
};

// Non-terminal workflow statuses an application can be moved between. Module
// scope (not in-component) so it's a stable reference and not a hook dep.
const WORKFLOW_STATUS = [
  "neu",
  "scan_eingegangen",
  "dokument_hochgeladen",
  "in_bearbeitung",
] as const;
type WorkflowStatus = (typeof WORKFLOW_STATUS)[number];

function AntragDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const detail = useQuery({
    queryKey: ["applications.get", id],
    queryFn: () => orpc.applications.get({ id }),
  });
  const feeTypes = useQuery({
    queryKey: ["feeTypes.list"],
    queryFn: () => orpc.feeTypes.list(),
  });

  const [art, setArt] = useState<number | "">("");
  const [betrag, setBetrag] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [workStatus, setWorkStatus] = useState<WorkflowStatus>("neu");
  // Seed the editor from the loaded application; re-seed whenever a different
  // application is opened (id change) so stale edits don't leak across rows.
  useEffect(() => {
    if (!detail.data) return;
    setNotes(detail.data.notes ?? "");
    const s = detail.data.status;
    setWorkStatus(
      (WORKFLOW_STATUS as readonly string[]).includes(s) ? (s as WorkflowStatus) : "neu",
    );
  }, [detail.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["applications.get", id] });
    qc.invalidateQueries({ queryKey: ["applications.list"] });
    qc.invalidateQueries({ queryKey: ["applications.stats"] });
  };

  const save = useMutation({
    mutationFn: () =>
      orpc.applications.update({ id, status: workStatus, notes: notes.trim() || null }),
    onSuccess: () => {
      setMsg("Gespeichert.");
      invalidate();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Speichern fehlgeschlagen."),
  });

  const approve = useMutation({
    mutationFn: () =>
      orpc.applications.approve({
        id,
        art: art === "" ? null : Number(art),
        betrag: betrag.trim() || null,
      }),
    onSuccess: (res) => {
      setMsg(`Genehmigt. Mitgliedsnummer: ${res.mitgliedsnummer}`);
      invalidate();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Genehmigung fehlgeschlagen."),
  });

  const decline = useMutation({
    mutationFn: () => orpc.applications.decline({ id, reason: declineReason.trim() }),
    onSuccess: () => {
      setMsg("Antrag abgelehnt.");
      invalidate();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Ablehnung fehlgeschlagen."),
  });

  const downloadFile = useMutation({
    mutationFn: (fileId: string) => orpc.applications.fileUrl({ id: fileId }),
    onSuccess: (res) => window.open(res.url, "_blank", "noopener,noreferrer"),
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Download fehlgeschlagen."),
  });

  if (detail.isError) {
    return (
      <QueryError
        title="Antrag konnte nicht geladen werden"
        error={detail.error}
        onRetry={() => detail.refetch()}
      />
    );
  }
  if (detail.isLoading || !detail.data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const a = detail.data;
  const terminal = a.status === "genehmigt" || a.status === "abgelehnt";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/app/antraege"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zur Liste
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {a.vorname} {a.nachname}
        </h1>
        <p className="text-sm text-muted-foreground">
          {a.antragsnummer} · {a.antragstyp} · Status: {a.status}
        </p>
      </div>

      {msg ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{msg}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Antragsdaten</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row label="Geburtsdatum">{fmtDate(a.geburtsdatum)}</Row>
          <Row label="E-Mail">{a.email ?? "—"}</Row>
          <Row label="Telefon">{a.telefon ?? "—"}</Row>
          <Row label="Anschrift">
            {[a.strasse, a.hausnummer].filter(Boolean).join(" ")} {a.plz} {a.ort}
          </Row>
          <Row label="Mitgliedschaft">{a.mitgliedschaftTyp}</Row>
          <Row label="Jahresbeitrag">{a.jahresbeitrag ? `${a.jahresbeitrag} €` : "—"}</Row>
          <Row label="IBAN">{a.ibanMasked ?? "—"}</Row>
          <Row label="Mandatsreferenz">{a.mandatsreferenz ?? "—"}</Row>
          {a.erziehungsberechtigterVorname ? (
            <Row label="Gesetzliche Vertretung">
              {a.erziehungsberechtigterVorname} {a.erziehungsberechtigterNachname}
            </Row>
          ) : null}
          {a.mitgliedsnummer ? <Row label="Mitgliedsnummer">{a.mitgliedsnummer}</Row> : null}
        </CardContent>
      </Card>

      {a.files.filter((f) => f.kind !== "signature_image").length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dokumente</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {a.files
              .filter((f) => f.kind !== "signature_image")
              .map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{FILE_KIND_LABEL[f.kind] ?? f.kind}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.filename ?? "—"} · {fmtDateTime(f.uploadedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={downloadFile.isPending}
                    onClick={() => downloadFile.mutate(f.id)}
                  >
                    <Download className="size-4" />
                    Öffnen
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {a.emails.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-5" /> E-Mail-Verlauf
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {a.emails.map((m) => {
              const status = EMAIL_STATUS[m.status] ?? EMAIL_STATUS_SKIPPED;
              const StatusIcon = status.icon;
              return (
                <div
                  key={m.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border/60 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{EMAIL_KIND_LABEL[m.kind] ?? m.kind}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.recipient ?? "—"} · {fmtDateTime(m.createdAt)}
                      {m.detail ? ` · ${EMAIL_DETAIL_LABEL[m.detail] ?? m.detail}` : ""}
                    </p>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1 text-xs ${status.cls}`}>
                    <StatusIcon className="size-4" />
                    {status.label}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {!terminal ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Save className="size-5 text-muted-foreground" /> Bearbeitung
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Label className="flex flex-col gap-1.5 sm:max-w-xs">
                <span>Status</span>
                <select
                  value={workStatus}
                  onChange={(e) => setWorkStatus(e.target.value as WorkflowStatus)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="neu">Eingegangen</option>
                  <option value="scan_eingegangen">Scan eingegangen</option>
                  <option value="dokument_hochgeladen">Dokument hochgeladen</option>
                  <option value="in_bearbeitung">In Bearbeitung</option>
                </select>
              </Label>
              <Label className="flex flex-col gap-1.5">
                <span>Interne Notizen</span>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Nur intern sichtbar"
                />
              </Label>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={save.isPending}
                onClick={() => {
                  setMsg(null);
                  save.mutate();
                }}
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" /> Genehmigen
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Legt ein Mitglied an (bei Familie inklusive Partner und Kindern) und übernimmt die
                Bankverbindung als SEPA-Mandat. Optional wird ein Beitragsvertrag erstellt.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Label className="flex flex-col gap-1.5">
                  <span>Beitragsart (optional)</span>
                  <select
                    value={art}
                    onChange={(e) => setArt(e.target.value === "" ? "" : Number(e.target.value))}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Kein Vertrag</option>
                    {feeTypes.data?.map((f) => (
                      <option key={f.art} value={f.art}>
                        {f.bezeichnung ?? `Art ${f.art}`}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label className="flex flex-col gap-1.5">
                  <span>Betrag (EUR)</span>
                  <Input
                    inputMode="decimal"
                    placeholder={a.jahresbeitrag ?? "z. B. 54,00"}
                    value={betrag}
                    onChange={(e) => setBetrag(e.target.value)}
                  />
                </Label>
              </div>
              <Button
                type="button"
                className="self-start"
                disabled={approve.isPending}
                onClick={() => {
                  setMsg(null);
                  approve.mutate();
                }}
              >
                {approve.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Genehmigen und Mitglied anlegen
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ban className="size-5 text-destructive" /> Ablehnen
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Label className="flex flex-col gap-1.5">
                <span>Begründung (wird dem Antragsteller per E-Mail mitgeteilt)</span>
                <Textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                />
              </Label>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={decline.isPending || declineReason.trim().length === 0}
                onClick={() => {
                  setMsg(null);
                  decline.mutate();
                }}
              >
                {decline.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Ban className="size-4" />
                )}
                Ablehnen
              </Button>
            </CardContent>
          </Card>
        </>
      ) : a.status === "genehmigt" && a.memberId ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            navigate({
              to: "/app/mitglieder/$mitgliedsnummer",
              params: { mitgliedsnummer: a.mitgliedsnummer?.split(",")[0]?.trim() ?? "" },
            })
          }
        >
          Zum Mitglied
        </Button>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
