import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  Loader2,
  Mail,
  MailCheck,
  MailWarning,
  MailX,
  RefreshCw,
  Save,
  ScanText,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PdfViewer } from "~/components/ui/pdf-viewer";
import { QueryError } from "~/components/ui/query-error";
import { Textarea } from "~/components/ui/textarea";
import { formatCurrency, formatDate, formatDateTime, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

const ANTRAGSTYP_LABEL: Record<string, string> = {
  einzel: "Einzelmitgliedschaft",
  kind: "Kindermitgliedschaft",
  familie: "Familienmitgliedschaft",
};

const STATUS_LABEL: Record<string, string> = {
  neu: "Eingegangen",
  scan_eingegangen: "Scan eingegangen",
  dokument_hochgeladen: "Dokument hochgeladen",
  in_bearbeitung: "In Bearbeitung",
  genehmigt: "Genehmigt",
  abgelehnt: "Abgelehnt",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "genehmigt"
      ? "bg-emerald-100 text-emerald-700"
      : status === "abgelehnt"
        ? "bg-red-100 text-red-700"
        : "bg-blue-100 text-blue-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const Route = createFileRoute("/app/antraege/$id")({
  component: AntragDetailPage,
});

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

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
  const dupes = useQuery({
    queryKey: ["applications.duplicateCandidates", id],
    queryFn: () => orpc.applications.duplicateCandidates({ applicationId: id }),
    enabled:
      !!detail.data && detail.data.status !== "genehmigt" && detail.data.status !== "abgelehnt",
  });

  const [art, setArt] = useState<number | "">("");
  const [betrag, setBetrag] = useState("");
  // Dedup gate: member id to link to instead of creating new (einzel only).
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [workStatus, setWorkStatus] = useState<WorkflowStatus>("neu");
  const [viewer, setViewer] = useState<{ url: string; filename: string } | null>(null);
  const [ocr, setOcr] = useState<{
    fileId: string;
    filename: string;
    available: boolean;
    text: string | null;
    error: string | null;
  } | null>(null);
  const signedUploadRef = useRef<HTMLInputElement>(null);
  // Seed the editor from the loaded application; re-seed whenever a different
  // application is opened (id change) so stale edits don't leak across rows.
  useEffect(() => {
    if (!detail.data) return;
    setNotes(detail.data.notes ?? "");
    const s = detail.data.status;
    setWorkStatus(
      (WORKFLOW_STATUS as readonly string[]).includes(s) ? (s as WorkflowStatus) : "neu",
    );
    // Pre-select the Beitragsart matched at submit time so the approved contract
    // uses the same Beitragsart the applicant was quoted from. The Vorstand can
    // still change it; the Betrag field falls back to the quoted Jahresbeitrag.
    if (detail.data.vorgeschlageneArt != null) setArt(detail.data.vorgeschlageneArt);
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
        linkToMemberId: linkTo,
      }),
    onSuccess: (res) => {
      setMsg(
        linkTo
          ? `Mit bestehendem Mitglied verknüpft: ${res.mitgliedsnummer}`
          : `Genehmigt. Mitgliedsnummer: ${res.mitgliedsnummer}`,
      );
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

  const openFile = useMutation({
    mutationFn: (fileId: string) => orpc.applications.fileUrl({ id: fileId }),
    onSuccess: (res) => setViewer({ url: res.url, filename: res.filename }),
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Öffnen fehlgeschlagen."),
  });

  const readText = useMutation({
    mutationFn: (file: { id: string; filename: string | null }) =>
      orpc.applications.fileText({ id: file.id }).then((res) => ({ ...res, file })),
    onSuccess: (res) =>
      setOcr({
        fileId: res.file.id,
        filename: res.file.filename ?? "Scan",
        available: res.available,
        text: res.text,
        error: res.error,
      }),
    onError: (e: unknown) =>
      setMsg(e instanceof Error ? e.message : "Texterkennung fehlgeschlagen."),
  });

  const resend = useMutation({
    mutationFn: () => orpc.applications.resendInitialMail({ id }),
    onSuccess: (res) => {
      setMsg(
        res.applicantSent || res.clubSent
          ? "E-Mail erneut gesendet."
          : "E-Mail wurde nicht versendet. Bitte Versandprotokoll prüfen.",
      );
      invalidate();
    },
    onError: (e: unknown) =>
      setMsg(e instanceof Error ? e.message : "E-Mail-Versand fehlgeschlagen."),
  });

  const adminUploadSigned = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 20 * 1024 * 1024) throw new Error("Datei zu groß (max. 20 MB).");
      const contentBase64 = await readAsBase64(file);
      return orpc.applications.adminUploadSigned({
        id,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
      });
    },
    onSuccess: () => {
      setMsg("Unterschriebenes Dokument hochgeladen.");
      invalidate();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Upload fehlgeschlagen."),
  });

  const setArchived = useMutation({
    mutationFn: (next: boolean) => orpc.applications.setArchived({ id, archived: next }),
    onSuccess: (_res, next) => {
      setMsg(next ? "Antrag archiviert." : "Antrag aus dem Archiv geholt.");
      invalidate();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Aktion fehlgeschlagen."),
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => orpc.applications.remove({ id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications.list"] });
      qc.invalidateQueries({ queryKey: ["applications.stats"] });
      navigate({ to: "/app/antraege" });
    },
    onError: (e: unknown) => {
      setConfirmDelete(false);
      setMsg(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    },
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
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <StatusBadge status={a.status} />
          {a.archivedAt ? (
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              Archiviert
            </span>
          ) : null}
          <span>
            Antrag <span className="font-mono text-foreground">{a.antragsnummer}</span>
          </span>
          <span aria-hidden>·</span>
          <span>{ANTRAGSTYP_LABEL[a.antragstyp] ?? a.antragstyp}</span>
        </div>
      </div>

      {msg ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{msg}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Antragsdaten</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row label="Geburtsdatum">{orEmpty(formatDate(a.geburtsdatum))}</Row>
          <Row label="E-Mail">{orEmpty(a.email)}</Row>
          <Row label="Telefon">{orEmpty(a.telefon)}</Row>
          <Row label="Anschrift">
            {[a.strasse, a.hausnummer].filter(Boolean).join(" ")} {a.plz} {a.ort}
          </Row>
          <Row label="Mitgliedschaft">{a.mitgliedschaftTyp}</Row>
          <Row label="Jahresbeitrag">{formatCurrency(a.jahresbeitrag)}</Row>
          <Row label="IBAN">
            <span className="font-mono">{orEmpty(a.ibanFormatted)}</span>
          </Row>
          <Row label="Mandatsreferenz">{orEmpty(a.mandatsreferenz)}</Row>
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
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Dokumente</span>
              {!terminal ? (
                <>
                  <input
                    ref={signedUploadRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) adminUploadSigned.mutate(f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={adminUploadSigned.isPending}
                    onClick={() => signedUploadRef.current?.click()}
                  >
                    {adminUploadSigned.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    Scan hochladen
                  </Button>
                </>
              ) : null}
            </CardTitle>
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
                      {orEmpty(f.filename)} · {formatDateTime(f.uploadedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={openFile.isPending}
                    onClick={() => openFile.mutate(f.id)}
                  >
                    {openFile.isPending && openFile.variables === f.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                    Öffnen
                  </Button>
                  {f.kind === "signed_scan" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={readText.isPending}
                      onClick={() => readText.mutate({ id: f.id, filename: f.filename })}
                    >
                      {readText.isPending && readText.variables?.id === f.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ScanText className="size-4" />
                      )}
                      Text
                    </Button>
                  ) : null}
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {ocr ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <ScanText className="size-5" /> Texterkennung: {ocr.filename}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!ocr.text}
                  onClick={async () => {
                    if (!ocr.text) return;
                    await navigator.clipboard.writeText(ocr.text);
                  }}
                >
                  <Copy className="size-4" />
                  Kopieren
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOcr(null)}>
                  Schließen
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ocr.available && ocr.text ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
                {ocr.text}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                {ocr.error ?? "Texterkennung ist für diesen Scan nicht verfügbar."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {a.emails.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <Mail className="size-5" /> E-Mail-Verlauf
              </span>
              {!terminal ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resend.isPending}
                  onClick={() => {
                    setMsg(null);
                    resend.mutate();
                  }}
                >
                  {resend.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Erneut senden
                </Button>
              ) : null}
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
                      {orEmpty(m.recipient)} · {formatDateTime(m.createdAt)}
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

      {!terminal && a.emails.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <Mail className="size-5" /> E-Mail-Verlauf
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resend.isPending}
                onClick={() => {
                  setMsg(null);
                  resend.mutate();
                }}
              >
                {resend.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Erneut senden
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Für diesen Antrag wurde noch kein E-Mail-Versand protokolliert.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!terminal && a.files.filter((f) => f.kind !== "signature_image").length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dokumente</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={signedUploadRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) adminUploadSigned.mutate(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={adminUploadSigned.isPending}
              onClick={() => signedUploadRef.current?.click()}
            >
              {adminUploadSigned.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Unterschriebenes Dokument hochladen
            </Button>
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

              {dupes.isLoading ? (
                <p className="text-sm text-muted-foreground">Prüfe auf mögliche Dubletten…</p>
              ) : dupes.data && dupes.data.candidates.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="size-4" />
                    Mögliche Dubletten gefunden ({dupes.data.candidates.length})
                  </div>
                  <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                    Bitte prüfen: neues Mitglied anlegen oder mit einem bestehenden verknüpfen. Bei
                    Familien- und Kinderanträgen wird der Hauptantragsteller verknüpft, die übrigen
                    Personen werden neu angelegt.
                  </p>
                  <div className="flex flex-col gap-1">
                    {dupes.data.candidates.map((c) => {
                      const selected = linkTo === c.id && c.kind === "member";
                      const linkable = c.kind === "member";
                      return (
                        <div
                          key={`${c.kind}-${c.id}`}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5 text-sm"
                        >
                          <Badge variant={c.kind === "member" ? "secondary" : "outline"}>
                            {c.kind === "member"
                              ? (c.memberNo ?? c.kontaktNo ?? "Mitglied")
                              : "Antrag"}
                          </Badge>
                          <span className="font-medium">{c.name || "—"}</span>
                          <span className="text-xs text-muted-foreground">
                            {[c.geburtsdatum, c.ort].filter(Boolean).join(" · ")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {c.reasons.join(", ")}
                          </span>
                          {linkable ? (
                            <Button
                              type="button"
                              size="sm"
                              variant={selected ? "default" : "outline"}
                              className="ml-auto"
                              onClick={() => setLinkTo(selected ? null : c.id)}
                            >
                              {selected ? "Verknüpft" : "Verknüpfen"}
                            </Button>
                          ) : c.kind === "application" ? (
                            <Link
                              to="/app/antraege/$id"
                              params={{ id: c.id }}
                              className="ml-auto text-xs text-primary hover:underline"
                            >
                              Antrag öffnen
                            </Link>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {linkTo ? (
                    <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                      Beim Genehmigen wird kein neues Mitglied angelegt, sondern das gewählte
                      bestehende aktualisiert (fehlende Daten, Vertrag und Mandat falls nötig,
                      Antrag verknüpft).
                    </p>
                  ) : null}
                </div>
              ) : null}
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
              {art === "" ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Ohne Beitragsart wird kein Vertrag angelegt. Das Mitglied wird dann nicht
                    abgerechnet, bis später ein Vertrag erfasst wird.
                  </span>
                </div>
              ) : null}
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
                {linkTo ? "Genehmigen und verknüpfen" : "Genehmigen und Mitglied anlegen"}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="size-5 text-muted-foreground" /> Verwaltung
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Archivieren blendet den Antrag aus der Standardliste aus, ohne ihn zu löschen.
            Endgültiges Löschen entfernt den Antrag samt Dokumenten und kann nicht rückgängig
            gemacht werden.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={setArchived.isPending}
              onClick={() => {
                setMsg(null);
                setArchived.mutate(!a.archivedAt);
              }}
            >
              {setArchived.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : a.archivedAt ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {a.archivedAt ? "Aus Archiv holen" : "Archivieren"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                setMsg(null);
                setConfirmDelete(true);
              }}
            >
              {remove.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Endgültig löschen
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Antrag endgültig löschen?"
        description={`Der Antrag ${a.antragsnummer} und alle zugehörigen Dokumente werden dauerhaft entfernt. Dies kann nicht rückgängig gemacht werden.`}
        confirmLabel="Endgültig löschen"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />

      <PdfViewer
        open={viewer !== null}
        onOpenChange={(o) => {
          if (!o) setViewer(null);
        }}
        url={viewer?.url ?? null}
        filename={viewer?.filename}
      />
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
