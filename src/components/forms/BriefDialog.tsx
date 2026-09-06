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
  const [senderName, setSenderName] = useState("");
  const [senderTitle, setSenderTitle] = useState("");
  const [contact, setContact] = useState("");
  const [returnAddress, setReturnAddress] = useState("");
  const [letterDate, setLetterDate] = useState("");
  const [signatureSpace, setSignatureSpace] = useState(false);
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
    setSenderName("");
    setSenderTitle("");
    setContact("");
    setReturnAddress("");
    setLetterDate("");
    setSignatureSpace(false);
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
        senderName,
        senderTitle,
        contact,
        returnAddress,
        letterDate: letterDate || undefined,
        signatureSpace,
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
      description="Persönlichen Brief schreiben. Vereinsbriefkopf und Anschrift werden übernommen. Ihre Anpassungen gelten nur für diesen Brief."
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
          <Label htmlFor="brief-betreff">Titel / Betreff *</Label>
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
            maxLength={20_000}
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

        <fieldset
          className="flex flex-col gap-3 rounded-md border border-border p-3"
          disabled={!closing.trim()}
        >
          <legend className="px-1 font-medium">Absender und Unterschrift</legend>
          <p className="text-xs text-muted-foreground">
            Name und Funktion stehen unter der Grußformel. Ohne Namen unterschreibt der Verein. Ohne
            Grußformel entfällt dieser gesamte Abschluss.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brief-sender">Absendername</Label>
              <Input
                id="brief-sender"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                maxLength={100}
                placeholder="z. B. Paul Dresch"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brief-title">Titel / Funktion</Label>
              <Input
                id="brief-title"
                value={senderTitle}
                onChange={(e) => setSenderTitle(e.target.value)}
                maxLength={100}
                placeholder="z. B. Mitgliederverwaltung"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brief-contact">Kontakt für Rückfragen</Label>
            <Input
              id="brief-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={160}
              placeholder="E-Mail oder Telefon (optional)"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={signatureSpace}
              onChange={(e) => setSignatureSpace(e.target.checked)}
            />
            Platz für handschriftliche Unterschrift
          </label>
          {closing.trim() ? (
            <section
              className="whitespace-pre-wrap rounded-md bg-background p-3 text-sm"
              aria-label="Vorschau des Briefabschlusses"
            >
              <p>{closing.trim()}</p>
              {signatureSpace ? <div className="h-12" /> : null}
              <p>{senderName.trim() || "Vereinsname aus den Einstellungen"}</p>
              {senderTitle.trim() ? <p>{senderTitle.trim()}</p> : null}
              {contact.trim() ? <p>{contact.trim()}</p> : null}
            </section>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 font-medium">Briefdetails</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brief-date">Briefdatum</Label>
            <Input
              id="brief-date"
              type="date"
              value={letterDate}
              onChange={(e) => setLetterDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leer lassen für heute. Das Erstellungsdatum im Protokoll bleibt erhalten.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brief-return">Abweichende Rücksendeadresse</Label>
            <Input
              id="brief-return"
              value={returnAddress}
              onChange={(e) => setReturnAddress(e.target.value)}
              maxLength={180}
              placeholder="Name · Straße Hausnummer · PLZ Ort"
            />
            <p className="text-xs text-muted-foreground">
              Kleine Zeile über der Empfängeranschrift. Leer lassen für die Vereinsadresse.
            </p>
          </div>
        </fieldset>

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
