import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileDown, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { triggerDocumentDownload } from "~/lib/download";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

const DEFAULT_CLOSING = "Freundliche Grüße";

/**
 * A stored file is named for the filesystem, not for a reader. On a letter the
 * Anlagenvermerk should say what the document is; the operator can still
 * override the wording per enclosure.
 */
function readableAttachmentLabel(kind: string | undefined, filename: string): string {
  if (kind === "cancellation_notice") return "Ihre Austrittserklärung";
  if (kind === "bank_details_change") return "Nachweis zur Bankverbindung";
  return (
    filename
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || filename
  );
}

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
  anhaenge = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  hasAddress: boolean;
  /** The member's stored documents, offered as enclosures. */
  anhaenge?: { id: string; filename: string; kind?: string }[];
}) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [greeting, setGreeting] = useState("");
  const [body, setBody] = useState("");
  const [closing, setClosing] = useState(DEFAULT_CLOSING);
  const [error, setError] = useState<string | null>(null);
  const [enclosures, setEnclosures] = useState<string[]>([]);
  /** Per-enclosure wording for the Anlagenvermerk, keyed like the selection. */
  const [labels, setLabels] = useState<Record<string, string>>({});

  // The Austrittsbestätigung is the document most letters go out with, so the
  // list starts there rather than making the operator hunt for it.
  const letters = useQuery({
    queryKey: ["cancellations.listForMember", memberId],
    queryFn: () => orpc.cancellations.listForMember({ memberId }),
    enabled: open,
  });

  const available = [
    ...(letters.data ?? []).map((row) => ({
      key: `cancellation_letter:${row.id}`,
      source: "cancellation_letter" as const,
      id: row.id,
      label: `Austrittsbestätigung, Austritt zum ${formatDate(row.austrittDatum)}`,
    })),
    ...anhaenge.map((row) => ({
      key: `attachment:${row.id}`,
      source: "attachment" as const,
      id: row.id,
      label: readableAttachmentLabel(row.kind, row.filename),
    })),
  ];

  useEffect(() => {
    if (open) {
      setGreeting(memberName ? `Sehr geehrte(r) ${memberName},` : "");
      return;
    }
    setSubject("");
    setBody("");
    setClosing(DEFAULT_CLOSING);
    setEnclosures([]);
    setLabels({});
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
        enclosures: available
          .filter((entry) => enclosures.includes(entry.key))
          .map((entry) => ({
            source: entry.source,
            id: entry.id,
            label: labels[entry.key]?.trim() || entry.label,
          })),
      }),
    onSuccess: async (res) => {
      triggerDocumentDownload(res);
      toast.success(`Brief ${res.docRef} erzeugt.`, {
        description:
          res.enclosures.length > 0
            ? `Als Anlage vermerkt: ${res.enclosures.map((e) => e.label).join(", ")}. Die Dokumente liegen im Reiter Dokumente zum Ausdrucken.`
            : "Der Vorgang steht als Postversand im Versandprotokoll.",
        durationMs: res.enclosures.length > 0 ? 10_000 : undefined,
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

        {available.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label>Anlagen</Label>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-2">
              {available.map((entry) => (
                <div key={entry.key} className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enclosures.includes(entry.key)}
                      onChange={(e) =>
                        setEnclosures((current) =>
                          e.target.checked
                            ? [...current, entry.key]
                            : current.filter((key) => key !== entry.key),
                        )
                      }
                    />
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 truncate">{entry.label}</span>
                  </label>
                  {enclosures.includes(entry.key) ? (
                    <Input
                      value={labels[entry.key] ?? entry.label}
                      onChange={(e) =>
                        setLabels((current) => ({ ...current, [entry.key]: e.target.value }))
                      }
                      maxLength={120}
                      aria-label={`Bezeichnung für ${entry.label}`}
                      className="ml-6 h-8 text-xs"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Wird auf dem Brief als Anlage vermerkt. Das Dokument selbst drucken Sie aus dem Reiter
              Dokumente und legen es bei.
            </p>
          </div>
        ) : null}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileDown className="size-3.5 shrink-0" aria-hidden />
          Der Brief wird als PDF heruntergeladen und im Versandprotokoll vermerkt.
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </ConfirmDialog>
  );
}
