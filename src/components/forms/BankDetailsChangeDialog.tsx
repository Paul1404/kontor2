import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, FileUp, Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { orpc } from "~/lib/orpc";
import { formatIbanGrouped, normalizeIban, validateIban } from "~/server/sepa/iban";

const ACCEPT = ".pdf,.eml,.msg,.png,.jpg,.jpeg";
const MAX_BYTES = 10 * 1024 * 1024;

export function BankDetailsChangeDialog({
  open,
  onOpenChange,
  memberId,
  mitgliedsnummer,
  currentIban,
  currentAccountHolder,
  expectedUpdatedAt,
  hasActiveMandate,
  directDebitBlocked,
  affectedMemberCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  mitgliedsnummer: string;
  currentIban: string | null;
  currentAccountHolder: string | null;
  expectedUpdatedAt: string;
  hasActiveMandate: boolean;
  directDebitBlocked: boolean;
  affectedMemberCount: number;
}) {
  const qc = useQueryClient();
  const [iban, setIban] = useState("");
  const [holderMode, setHolderMode] = useState<"self" | "other">(
    currentAccountHolder ? "other" : "self",
  );
  const [accountHolder, setAccountHolder] = useState(currentAccountHolder ?? "");
  const [requestedAt, setRequestedAt] = useState(todayInput());
  const [note, setNote] = useState("");
  const [debitAction, setDebitAction] = useState<"keep" | "suspend">(
    hasActiveMandate && !directDebitBlocked ? "keep" : "suspend",
  );
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(false);
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedIban = useMemo(() => normalizeIban(iban), [iban]);
  const validIban = validateIban(normalizedIban);
  const bank = useQuery({
    queryKey: ["banks.lookupByIban", normalizedIban],
    queryFn: () => orpc.banks.lookupByIban({ iban: normalizedIban }),
    enabled: validIban && normalizedIban.startsWith("DE"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const derivedBank = bank.data?.found ? bank.data : null;
  const previewLast4 = validIban ? normalizedIban.slice(-4) : "XXXX";
  const emailPreview = useQuery({
    queryKey: ["bankDetails.confirmationPreview", memberId, previewLast4, debitAction],
    queryFn: () =>
      orpc.bankDetails.confirmationPreview({
        memberId,
        newIbanLast4: previewLast4,
        debitAction,
      }),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setHolderMode(currentAccountHolder ? "other" : "self");
    setAccountHolder(currentAccountHolder ?? "");
    setDebitAction(hasActiveMandate && !directDebitBlocked ? "keep" : "suspend");
    setSendConfirmationEmail(false);
    setEmailPreviewOpen(false);
  }, [open, currentAccountHolder, directDebitBlocked, hasActiveMandate]);

  const change = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Bitte einen Nachweis auswählen.");
      if (!validIban) throw new Error("IBAN ungültig (Prüfsumme fehlerhaft).");
      if (normalizeIban(currentIban ?? "") === normalizedIban) {
        throw new Error("Die neue IBAN entspricht der bisherigen IBAN.");
      }
      if (holderMode === "other" && !accountHolder.trim()) {
        throw new Error("Bitte den Namen des Kontoinhabers eingeben.");
      }
      if (file.size > MAX_BYTES) throw new Error("Datei zu groß (max. 10 MB).");

      const ticket = await orpc.attachments.requestUploadUrl({
        memberId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        kind: "bank_details_change",
      });
      let upload: Response;
      try {
        upload = await fetch(ticket.url, {
          method: "PUT",
          headers: { "Content-Type": ticket.mimeType },
          body: file,
        });
      } catch {
        throw new Error("Nachweis konnte nicht hochgeladen werden. Bitte erneut versuchen.");
      }
      if (!upload.ok) {
        throw new Error(`Nachweis konnte nicht hochgeladen werden (${upload.status}).`);
      }
      return orpc.bankDetails.applyChange({
        memberId,
        uploadId: ticket.uploadId,
        iban: normalizedIban,
        bic: derivedBank?.bic ?? null,
        accountHolder: holderMode === "other" ? accountHolder.trim() : null,
        requestedAt,
        note: note.trim() || null,
        debitAction,
        evidenceConfirmed: true,
        sendConfirmationEmail,
        expectedUpdatedAt,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] }),
        qc.invalidateQueries({ queryKey: ["members.list"] }),
        qc.invalidateQueries({ queryKey: ["bankDetails.recentChanges", memberId] }),
        qc.invalidateQueries({ queryKey: ["timeline.forMember", memberId] }),
      ]);
      if (result.confirmation.status === "sent") {
        toast.success("Bankverbindung geändert. Bestätigungs-E-Mail versendet.");
      } else if (result.confirmation.status === "failed") {
        toast.info("Bankverbindung geändert. Bestätigungs-E-Mail nicht versendet.", {
          description:
            "Bitte informieren Sie das Mitglied auf anderem Weg. Details stehen im Versandprotokoll.",
          durationMs: 8_000,
        });
      } else {
        toast.success("Bankverbindung geändert. Nachweis gespeichert.");
      }
      onOpenChange(false);
      setIban("");
      setFile(null);
      setNote("");
      setConfirmed(false);
      setSendConfirmationEmail(false);
      setEmailPreviewOpen(false);
      setError(null);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Bankverbindung wurde nicht geändert.");
    },
  });

  const holderChanged =
    (holderMode === "other" ? accountHolder.trim() : "") !== (currentAccountHolder?.trim() ?? "");
  const formReady =
    validIban &&
    normalizeIban(currentIban ?? "") !== normalizedIban &&
    Boolean(requestedAt) &&
    Boolean(file) &&
    (holderMode === "self" || Boolean(accountHolder.trim())) &&
    confirmed;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!change.isPending) onOpenChange(next);
      }}
      title={currentIban ? "Bankverbindung ändern" : "Bankverbindung hinterlegen"}
      description="Erfassen Sie die neuen Daten und hängen Sie die Änderungsmitteilung an."
      confirmLabel="Änderung übernehmen"
      loading={change.isPending}
      confirmDisabled={!formReady}
      onConfirm={() => {
        setError(null);
        change.mutate();
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-background px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Aktuelle Bankverbindung
          </p>
          <p className="mt-1 font-mono text-sm">
            {currentIban ? `•••• ${normalizeIban(currentIban).slice(-4)}` : "Noch nicht hinterlegt"}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-change-iban">Neue IBAN *</Label>
          <Input
            id="bank-change-iban"
            value={iban}
            onChange={(event) => setIban(event.target.value)}
            placeholder="DE…"
            className="font-mono"
            autoComplete="off"
          />
          {iban && !validIban ? (
            <p className="text-xs text-destructive">IBAN ungültig (Prüfsumme fehlerhaft).</p>
          ) : derivedBank ? (
            <p className="text-xs text-muted-foreground">
              {derivedBank.name} · BIC {derivedBank.bic}
            </p>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Kontoinhaber *</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bank-change-holder"
              checked={holderMode === "self"}
              onChange={() => setHolderMode("self")}
            />
            Mitglied selbst
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bank-change-holder"
              checked={holderMode === "other"}
              onChange={() => setHolderMode("other")}
            />
            Andere Person
          </label>
          {holderMode === "other" ? (
            <Input
              value={accountHolder}
              onChange={(event) => setAccountHolder(event.target.value)}
              placeholder="Name des Kontoinhabers"
            />
          ) : null}
        </fieldset>

        {holderChanged ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            Der Kontoinhaber ändert sich. Bitte prüfen Sie, ob das vorhandene SEPA-Mandat weiterhin
            ausreicht.
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">SEPA-Einzug</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="bank-change-debit"
              checked={debitAction === "keep"}
              disabled={!hasActiveMandate}
              onChange={() => setDebitAction("keep")}
            />
            <span>
              Bestehendes Mandat weiterverwenden
              {!hasActiveMandate ? (
                <span className="block text-xs text-muted-foreground">
                  Nicht verfügbar, da kein aktives Mandat vorliegt.
                </span>
              ) : null}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bank-change-debit"
              checked={debitAction === "suspend"}
              onChange={() => setDebitAction("suspend")}
            />
            Einzug vorerst aussetzen
          </label>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-change-requested-at">Anfrage eingegangen am *</Label>
          <DateField id="bank-change-requested-at" value={requestedAt} onChange={setRequestedAt} />
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background p-3">
          <FileUp className="size-5 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {file?.name ?? "Nachweis auswählen *"}
            </span>
            <span className="text-xs text-muted-foreground">
              PDF, EML, MSG, PNG oder JPG · max. 10 MB
            </span>
          </span>
          <input
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              setError(null);
              event.target.value = "";
            }}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-change-note">Interne Notiz</Label>
          <Textarea
            id="bank-change-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={sendConfirmationEmail}
              disabled={!emailPreview.data?.canSend}
              onChange={(event) => {
                setSendConfirmationEmail(event.target.checked);
                if (event.target.checked) setEmailPreviewOpen(true);
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Mail className="size-4" aria-hidden />
                Bestätigung per E-Mail senden
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {emailPreview.isLoading
                  ? "E-Mail-Einstellungen werden geprüft…"
                  : emailPreview.data?.reason === "no_recipient"
                    ? "Für dieses Mitglied ist keine E-Mail-Adresse hinterlegt."
                    : emailPreview.data?.reason === "smtp_not_configured"
                      ? "SMTP ist nicht konfiguriert."
                      : emailPreview.data?.to
                        ? `An ${emailPreview.data.to}`
                        : "E-Mail-Vorschau ist nicht verfügbar."}
              </span>
            </span>
          </label>

          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between border-t border-border pt-3 text-left text-xs font-medium"
            aria-expanded={emailPreviewOpen}
            onClick={() => setEmailPreviewOpen((current) => !current)}
          >
            E-Mail-Vorschau
            <ChevronDown
              className={`size-4 transition-transform ${emailPreviewOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {emailPreviewOpen && emailPreview.data ? (
            <div className="mt-3 space-y-2 text-xs">
              <p>
                <span className="font-medium">An:</span>{" "}
                {emailPreview.data.to ?? "Keine E-Mail-Adresse hinterlegt"}
              </p>
              <p>
                <span className="font-medium">Betreff:</span> {emailPreview.data.subject}
              </p>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-relaxed">
                {emailPreview.data.body}
              </pre>
              {!validIban ? (
                <p className="text-muted-foreground">
                  Die Vorschau zeigt XXXX, bis eine gültige neue IBAN eingegeben wurde.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Bereits erzeugte SEPA-Dateien bleiben unverändert. Künftige Läufe verwenden die neue
          Bankverbindung.
        </p>
        {affectedMemberCount > 0 ? (
          <p className="rounded-md border border-border bg-background p-2 text-xs">
            Dieser Zahler ist mit {affectedMemberCount}{" "}
            {affectedMemberCount === 1 ? "weiteren Datensatz" : "weiteren Datensätzen"} verknüpft.
            Deren künftige Einzüge können ebenfalls diese Bankverbindung verwenden.
          </p>
        ) : null}
        {validIban && file ? (
          <div className="rounded-md border border-border bg-background p-3 text-xs">
            <p className="font-medium">Prüfung</p>
            <p className="mt-1 text-muted-foreground">
              Neue IBAN {formatIbanGrouped(normalizedIban)} · Nachweis {file.name}
            </p>
          </div>
        ) : null}
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Ich habe geprüft, dass der Nachweis die neue Bankverbindung eindeutig bestätigt.
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ConfirmDialog>
  );
}

function todayInput(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
