import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mailbox, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MailPreview, type MailPreviewAttachment } from "~/components/mail/MailPreview";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Switch } from "~/components/ui/switch";
import { toast } from "~/components/ui/toaster";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

/**
 * Send the member their Austritt confirmation, optionally with a stored
 * Austrittsbestätigung attached. Deliberately usable long after the Kündigung
 * was recorded: the letter is normally generated afterwards, and a member who
 * was never informed should still be reachable.
 */
export function KuendigungsMailDialog({
  open,
  onOpenChange,
  memberId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
}) {
  const qc = useQueryClient();
  const [attach, setAttach] = useState(true);
  const [attachNotice, setAttachNotice] = useState(true);
  const [letterId, setLetterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the selection so the shown text is the text that would be sent.
  const preview = useQuery({
    queryKey: ["cancellations.confirmationPreview", memberId, attach, attachNotice],
    queryFn: () =>
      orpc.cancellations.confirmationPreview({
        memberId,
        attachLetter: attach,
        attachNotice,
      }),
    enabled: open,
    staleTime: 30_000,
  });

  const isPostal = preview.data?.channel === "post";
  const letters = preview.data?.letters ?? [];
  const hasLetter = letters.length > 0;
  const notice = preview.data?.notice ?? null;

  // Seed the toggles from what exists, but only once per opening. Re-running
  // on every load would fight the operator: the query re-fetches whenever a
  // toggle changes, and the effect would immediately reset it.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      setError(null);
      return;
    }
    if (seeded.current || preview.data === undefined) return;
    seeded.current = true;
    setLetterId(preview.data.letters[0]?.id ?? null);
    setAttach(preview.data.letters.length > 0);
    setAttachNotice(preview.data.notice != null);
  }, [open, preview.data]);

  // Exactly the files that would be attached, resolvable to a viewable URL.
  const previewAttachments: MailPreviewAttachment[] = [
    ...(attach && letterId
      ? [
          {
            id: letterId,
            filename:
              letters.find((l) => l.id === letterId)?.filename ?? "Austrittsbestaetigung.pdf",
            resolveUrl: async () => (await orpc.cancellations.download({ id: letterId })).url,
          },
        ]
      : []),
    ...(attachNotice && notice
      ? [
          {
            id: notice.attachmentId,
            filename: notice.filename,
            sizeBytes: notice.sizeBytes,
            mimeType: notice.mimeType,
            resolveUrl: async () => `/api/files/${notice.attachmentId}?inline=1`,
          },
        ]
      : []),
  ];

  const send = useMutation({
    mutationFn: () =>
      orpc.cancellations.sendConfirmation({
        memberId,
        letterId: attach ? letterId : null,
        attachNotice: attachNotice && notice != null,
      }),
    onSuccess: async (res) => {
      const enclosed = [
        res.letterAttached ? "Austrittsbestätigung" : null,
        res.noticeAttached ? "Austrittserklärung" : null,
      ].filter(Boolean);
      toast.success(`Bestätigung an ${res.to} gesendet.`, {
        description:
          enclosed.length > 0 ? `Anhang: ${enclosed.join(", ")}` : "Ohne Anhang versendet.",
      });
      await qc.invalidateQueries({ queryKey: ["timeline.forMember", memberId] });
      onOpenChange(false);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Versand fehlgeschlagen.");
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!send.isPending) onOpenChange(next);
      }}
      title="Austritt bestätigen"
      description={
        isPostal
          ? "Für dieses Mitglied ist keine erreichbare E-Mail-Adresse hinterlegt. Die Bestätigung geht per Post."
          : "Das Mitglied erhält den Austrittstermin und die angewandte Satzungsregel."
      }
      confirmLabel="E-Mail senden"
      cancelLabel="Abbrechen"
      loading={send.isPending}
      confirmDisabled={!preview.data?.canSend || isPostal}
      onConfirm={() => {
        setError(null);
        send.mutate();
      }}
    >
      <div className="flex flex-col gap-4">
        {preview.isPending ? (
          <p className="text-sm text-muted-foreground">Vorschau wird geladen…</p>
        ) : preview.isError ? (
          <p className="text-sm text-destructive">
            {preview.error instanceof Error ? preview.error.message : "Vorschau nicht verfügbar."}
          </p>
        ) : preview.data ? (
          <>
            {isPostal ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <Mailbox className="size-4" aria-hidden /> Postweg
                </p>
                <p className="text-muted-foreground">
                  {preview.data.to
                    ? "Die hinterlegte Adresse wurde vom Mailserver als nicht erreichbar zurückgewiesen."
                    : "Für dieses Mitglied ist keine E-Mail-Adresse hinterlegt."}{" "}
                  {preview.data.canPost
                    ? "Die Austrittsbestätigung eine Karte tiefer ist der Brief für dieses Mitglied. Sobald sie erstellt ist, gilt der Austritt als schriftlich bestätigt und erscheint so im Versandprotokoll."
                    : "Es ist auch keine vollständige Anschrift hinterlegt, ein Brief lässt sich daher nicht adressieren."}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Empfänger
                </p>
                <p className="mt-1">{preview.data.to}</p>
              </div>
            )}

            {preview.data.reason === "smtp_not_configured" ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span className="text-foreground">
                  SMTP ist nicht konfiguriert. Bitte unter Einstellungen, E-Mail einrichten.
                </span>
              </p>
            ) : null}

            <div className="rounded-md border border-border bg-background p-3">
              <Switch
                id="kuendigung-mail-anhang"
                checked={attach && hasLetter}
                disabled={!hasLetter}
                onChange={(e) => setAttach(e.target.checked)}
                label="Austrittsbestätigung anhängen"
                description={
                  hasLetter
                    ? "Das gespeicherte PDF geht als Anhang mit."
                    : "Noch keine Austrittsbestätigung erstellt. Die E-Mail geht ohne Anhang."
                }
              />
              {hasLetter && attach && letters.length === 1 ? (
                <p className="mt-2 flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                  <Paperclip className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">
                    {letters[0]?.docRef ?? letters[0]?.filename}
                  </span>
                </p>
              ) : null}
              {notice ? (
                <div className="mt-3 border-t border-border pt-3">
                  <Switch
                    id="kuendigung-mail-erklaerung"
                    checked={attachNotice}
                    onChange={(e) => setAttachNotice(e.target.checked)}
                    label="Austrittserklärung zurücksenden"
                    description="Das Mitglied sieht, welches Schreiben bei uns eingegangen ist."
                  />
                  <p className="mt-2 flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                    <Paperclip className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{notice.filename}</span>
                  </p>
                </div>
              ) : null}
              {attach && letters.length > 1 ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {letters.map((letter) => (
                    <label
                      key={letter.id}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <input
                        type="radio"
                        name="kuendigung-mail-letter"
                        checked={letterId === letter.id}
                        onChange={() => setLetterId(letter.id)}
                      />
                      <Paperclip className="size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {letter.docRef ?? letter.filename}
                      </span>
                      <span className="shrink-0 text-xs">{formatDateTime(letter.createdAt)}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <MailPreview
              to={preview.data.to}
              subject={preview.data.subject}
              html={preview.data.html}
              text={preview.data.body}
              attachments={previewAttachments}
            />
          </>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ConfirmDialog>
  );
}
