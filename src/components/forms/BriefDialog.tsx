import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { triggerDownloadBase64 } from "~/lib/download";
import { orpc } from "~/lib/orpc";

const DEFAULT_CLOSING = "Freundliche Grüße";

/**
 * Write one free-text letter to a member. The Serienbrief covers a segment;
 * this is the single letter that previously meant rebuilding letterhead and
 * address field by hand in a word processor.
 */
export function BriefDialog({
  open,
  onOpenChange,
  memberId,
  memberName,
  hasAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  hasAddress: boolean;
}) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [greeting, setGreeting] = useState("");
  const [body, setBody] = useState("");
  const [closing, setClosing] = useState(DEFAULT_CLOSING);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGreeting(memberName ? `Sehr geehrte(r) ${memberName},` : "");
      return;
    }
    setSubject("");
    setBody("");
    setClosing(DEFAULT_CLOSING);
    setError(null);
  }, [open, memberName]);

  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const create = useMutation({
    mutationFn: () =>
      orpc.letters.create({
        memberId,
        subject: subject.trim(),
        body,
        greeting: greeting.trim() || null,
        closing: closing.trim() || null,
      }),
    onSuccess: async (res) => {
      triggerDownloadBase64(res.base64, res.filename, "application/pdf");
      toast.success(`Brief ${res.docRef} erzeugt.`, {
        description: "Der Vorgang steht als Postversand im Versandprotokoll.",
      });
      await qc.invalidateQueries({ queryKey: ["letters.listForMember", memberId] });
      onOpenChange(false);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const ready = hasAddress && subject.trim().length > 0 && paragraphs.length > 0;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
      title="Brief schreiben"
      description="Betreff und Text eingeben. Briefkopf, Anschriftfeld und Falzmarken nach DIN 5008 kommen aus den Vereinsdaten."
      confirmLabel="Brief erzeugen"
      cancelLabel="Abbrechen"
      loading={create.isPending}
      confirmDisabled={!ready}
      onConfirm={() => {
        setError(null);
        create.mutate();
      }}
    >
      <div className="flex flex-col gap-4">
        {hasAddress ? null : (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="text-foreground">
              Für dieses Mitglied ist keine vollständige Anschrift hinterlegt. Bitte zuerst Straße,
              PLZ und Ort ergänzen.
            </span>
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brief-betreff">Betreff *</Label>
          <Input
            id="brief-betreff"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="z. B. Einladung zur Jahresfeier"
            maxLength={120}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brief-anrede">Anrede</Label>
          <Input
            id="brief-anrede"
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            maxLength={120}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brief-text">Text *</Label>
          <Textarea
            id="brief-text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
          />
          <p className="text-xs text-muted-foreground">
            Eine Leerzeile trennt Absätze. {paragraphs.length}{" "}
            {paragraphs.length === 1 ? "Absatz" : "Absätze"}.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brief-gruss">Grußformel</Label>
          <Input
            id="brief-gruss"
            value={closing}
            onChange={(e) => setClosing(e.target.value)}
            placeholder="Leer lassen, wenn der Text schon eine enthält"
            maxLength={60}
          />
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileDown className="size-3.5 shrink-0" aria-hidden />
          Der Brief wird als PDF heruntergeladen und im Versandprotokoll vermerkt.
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ConfirmDialog>
  );
}
