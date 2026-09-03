import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, FileUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { EMPTY_VALUE, formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

const ACCEPT = ".pdf,.eml,.msg,.png,.jpg,.jpeg";
const MAX_BYTES = 10 * 1024 * 1024;

type AbteilungRow = { austrittsdatum?: string | Date | null };
type VertragRow = { gekuendZum?: string | Date | null };
type SepaRow = { widerrufenAm?: string | Date | null; isDeleted?: boolean | null };
type SollRow = { status: string; openAmount: string | null };

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Record a member's Kündigung. The written Austrittserklärung is attached as
 * evidence and the Austrittstermin is derived from the day it arrived, using
 * the Satzung rule configured under Einstellungen. Everything the cascade will
 * close is listed before confirming.
 *
 * "Verwaltungseintrag" is the escape hatch for a correction or a backdated
 * entry with no scan on file. It writes the same cascade through
 * `members.austritt` but leaves no Kündigungs-Quittung behind.
 */
export function AustrittDialog({
  open,
  onOpenChange,
  memberId,
  memberName,
  expectedUpdatedAt,
  abteilungen,
  vertraege,
  sepa,
  sollstellungen,
  onLeft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  expectedUpdatedAt: string;
  abteilungen: AbteilungRow[];
  vertraege: VertragRow[];
  sepa: SepaRow[];
  sollstellungen: SollRow[];
  onLeft: (austrittDatum: string) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"kuendigung" | "verwaltung">("kuendigung");
  const [noticeReceivedOn, setNoticeReceivedOn] = useState(today);
  const [noticeDateValid, setNoticeDateValid] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideDateValid, setOverrideDateValid] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [note, setNote] = useState("");
  const [revokeSepa, setRevokeSepa] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [manualDate, setManualDate] = useState(today);
  const [manualDateValid, setManualDateValid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ["cancellations.previewDate", noticeReceivedOn],
    queryFn: () => orpc.cancellations.previewDate({ noticeReceivedOn }),
    enabled: open && mode === "kuendigung" && noticeDateValid && Boolean(noticeReceivedOn),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) return;
    setMode("kuendigung");
    setNoticeReceivedOn(today());
    setFile(null);
    setOverrideOpen(false);
    setOverrideDate("");
    setOverrideReason("");
    setNote("");
    setRevokeSepa(true);
    setConfirmed(false);
    setManualDate(today());
    setError(null);
  }, [open]);

  const openAbteilungen = useMemo(
    () => abteilungen.filter((a) => a.austrittsdatum == null).length,
    [abteilungen],
  );
  const openVertraege = useMemo(
    () => vertraege.filter((v) => v.gekuendZum == null).length,
    [vertraege],
  );
  const activeSepa = useMemo(
    () => sepa.filter((s) => !s.isDeleted && s.widerrufenAm == null).length,
    [sepa],
  );
  const offeneForderung = useMemo(() => {
    let sum = 0;
    for (const s of sollstellungen) {
      if (s.status === "cancelled" || s.status === "paid") continue;
      const n = Number(s.openAmount ?? "0");
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return sum;
  }, [sollstellungen]);

  const computedDate = preview.data?.effectiveDate ?? null;
  const usesOverride = overrideOpen && Boolean(overrideDate) && overrideDate !== computedDate;
  const effectiveDate =
    mode === "verwaltung" ? manualDate : usesOverride ? overrideDate : computedDate;

  const record = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Bitte die Austrittserklärung auswählen.");
      if (file.size > MAX_BYTES) throw new Error("Datei zu groß (max. 10 MB).");
      if (usesOverride && !overrideReason.trim()) {
        throw new Error("Für einen abweichenden Austrittstermin ist eine Begründung nötig.");
      }

      const ticket = await orpc.attachments.requestUploadUrl({
        memberId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        kind: "cancellation_notice",
      });
      let upload: Response;
      try {
        upload = await fetch(ticket.url, {
          method: "PUT",
          headers: { "Content-Type": ticket.mimeType },
          body: file,
        });
      } catch {
        throw new Error("Austrittserklärung konnte nicht hochgeladen werden.");
      }
      if (!upload.ok) {
        throw new Error(`Austrittserklärung konnte nicht hochgeladen werden (${upload.status}).`);
      }
      return orpc.cancellations.record({
        memberId,
        uploadId: ticket.uploadId,
        noticeReceivedOn,
        overrideEffectiveDate: usesOverride ? overrideDate : null,
        overrideReason: usesOverride ? overrideReason.trim() : null,
        revokeSepa,
        note: note.trim() || null,
        evidenceConfirmed: true,
        expectedUpdatedAt,
      });
    },
    onSuccess: async (res) => {
      toast.success(`Kündigung erfasst. Austritt zum ${formatDate(res.effectiveDate)}`, {
        description: [
          `${res.abteilungen} Abteilung(en)`,
          `${res.vertraege} Vertrag/Verträge`,
          `${res.sepaMandate} Mandat(e)`,
        ].join(", "),
      });
      await qc.invalidateQueries({ queryKey: ["cancellations.recordedForMember", memberId] });
      await qc.invalidateQueries({ queryKey: ["timeline.forMember", memberId] });
      onOpenChange(false);
      onLeft(res.effectiveDate);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Kündigung wurde nicht erfasst.");
    },
  });

  const manual = useMutation({
    mutationFn: () => orpc.members.austritt({ memberId, austrittDatum: manualDate, revokeSepa }),
    onSuccess: (res) => {
      toast.success("Austritt eingetragen", {
        description: [
          `${res.abteilungen} Abteilung(en)`,
          `${res.vertraege} Vertrag/Verträge`,
          `${res.sepaMandate} Mandat(e)`,
        ].join(", "),
      });
      onOpenChange(false);
      onLeft(manualDate);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Austritt fehlgeschlagen.");
    },
  });

  const pending = record.isPending || manual.isPending;
  const ready =
    mode === "verwaltung"
      ? manualDateValid && Boolean(manualDate)
      : noticeDateValid &&
        Boolean(file) &&
        Boolean(effectiveDate) &&
        (!usesOverride || (overrideDateValid && Boolean(overrideReason.trim()))) &&
        confirmed;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={mode === "verwaltung" ? "Austritt eintragen" : "Kündigung erfassen"}
      description={
        mode === "verwaltung"
          ? `Der Austritt wird ohne Nachweis auf ${memberName || "das Mitglied"} und alle offenen Datensätze übertragen.`
          : `Die schriftliche Austrittserklärung von ${memberName || "dem Mitglied"} wird gespeichert. Der Austrittstermin ergibt sich aus der Satzung.`
      }
      confirmLabel={mode === "verwaltung" ? "Austritt eintragen" : "Kündigung erfassen"}
      cancelLabel="Abbrechen"
      loading={pending}
      confirmDisabled={!ready}
      onConfirm={() => {
        setError(null);
        if (mode === "verwaltung") manual.mutate();
        else record.mutate();
      }}
    >
      <div className="flex flex-col gap-4">
        {mode === "kuendigung" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="austritt-eingang">Eingang der Austrittserklärung *</Label>
              <DateField
                id="austritt-eingang"
                value={noticeReceivedOn}
                onChange={setNoticeReceivedOn}
                onValidityChange={setNoticeDateValid}
                className="max-w-44"
              />
              <p className="text-xs text-muted-foreground">
                Der Tag, an dem die Erklärung beim Verein eingegangen ist. Die Kündigungsfrist zählt
                ab diesem Tag, nicht ab heute.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="size-4" aria-hidden />
                Austrittstermin nach Satzung
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {preview.isPending
                  ? "wird berechnet…"
                  : computedDate
                    ? formatDate(computedDate)
                    : EMPTY_VALUE}
              </p>
              {preview.data ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    preview.data.statuteReference,
                    preview.data.modeLabel,
                    preview.data.noticeDays > 0
                      ? `Frist ${preview.data.noticeDays} Tage`
                      : "keine Frist",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {preview.data.noticeDays > 0
                    ? `. Fristende für diesen Termin: ${formatDate(preview.data.noticeDeadline)}.`
                    : "."}
                </p>
              ) : null}
              {preview.data?.unconfigured ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Für diesen Verein ist keine Kündigungsregel hinterlegt. Der Termin entspricht dem
                  Eingangsdatum. Regel unter Einstellungen, Verein.
                </p>
              ) : null}
              {preview.data?.missedPeriodEnd ? (
                <p className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="text-foreground">
                    Für einen Austritt zum {formatDate(preview.data.missedPeriodEnd)} hätte die
                    Erklärung bis zum {formatDate(preview.data.missedPeriodDeadline)} vorliegen
                    müssen. Die Mitgliedschaft endet daher erst zum{" "}
                    {formatDate(preview.data.effectiveDate)}.
                  </span>
                </p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background p-3">
              <FileUp className="size-5 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {file?.name ?? "Austrittserklärung auswählen *"}
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
                  setFile(event.target.files?.[0] ?? null);
                  setError(null);
                  event.target.value = "";
                }}
              />
            </label>

            <div className="rounded-md border border-border bg-background p-3">
              <Switch
                id="austritt-override"
                checked={overrideOpen}
                onChange={(e) => {
                  setOverrideOpen(e.target.checked);
                  if (e.target.checked && !overrideDate && computedDate) {
                    setOverrideDate(computedDate);
                  }
                }}
                label="Abweichender Austrittstermin"
                description="Nur bei Aufhebungsvereinbarung oder Kulanz. Wird mit Begründung protokolliert."
              />
              {overrideOpen ? (
                <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="austritt-override-datum">Austritt zum</Label>
                    <DateField
                      id="austritt-override-datum"
                      value={overrideDate}
                      onChange={setOverrideDate}
                      onValidityChange={setOverrideDateValid}
                      className="max-w-44"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="austritt-override-grund">Begründung *</Label>
                    <Textarea
                      id="austritt-override-grund"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="austritt-datum">Austritt zum *</Label>
            <DateField
              id="austritt-datum"
              value={manualDate}
              onChange={setManualDate}
              onValidityChange={setManualDateValid}
              className="max-w-44"
            />
            <p className="text-xs text-muted-foreground">
              Die Kündigungsfrist wird ab heute geprüft. Es wird keine Kündigungs-Quittung angelegt.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 font-medium text-foreground">
            Wird auf {effectiveDate ? formatDate(effectiveDate) : "das Austrittsdatum"} gesetzt:
          </p>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            <li>{openAbteilungen} offene Abteilungs-Mitgliedschaft(en)</li>
            <li>{openVertraege} laufende(r) Vertrag/Verträge</li>
            <li>
              {activeSepa} aktive(s) SEPA-Mandat(e)
              {revokeSepa ? "" : " (bleiben unverändert)"}
            </li>
          </ul>
        </div>

        {offeneForderung > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-foreground">
              Es bestehen noch offene Forderungen über {formatCurrency(String(offeneForderung))}.
              Der Austritt storniert diese nicht
              {preview.data?.outstandingClaimsStatuteReference
                ? ` (${preview.data.outstandingClaimsStatuteReference})`
                : ""}
              . Bitte separat klären.
            </p>
          </div>
        ) : null}

        <Switch
          id="austritt-sepa"
          checked={revokeSepa}
          onChange={(e) => setRevokeSepa(e.target.checked)}
          label="SEPA-Mandate widerrufen"
          description="Verhindert weitere Lastschriften nach dem Austritt."
        />

        {mode === "kuendigung" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="austritt-notiz">Interne Notiz</Label>
              <Textarea
                id="austritt-notiz"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Ich habe geprüft, dass die Datei die Austrittserklärung dieses Mitglieds ist.
            </label>
          </>
        ) : null}

        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => {
            setMode((current) => (current === "kuendigung" ? "verwaltung" : "kuendigung"));
            setError(null);
          }}
        >
          {mode === "kuendigung"
            ? "Kein Nachweis vorhanden? Als Verwaltungseintrag erfassen"
            : "Zurück zur Kündigung mit Nachweis"}
        </button>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ConfirmDialog>
  );
}
