import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string | Date;
};

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

export function AttachmentsCard({
  memberId,
  mitgliedsnummer,
  anhaenge,
  canEdit,
}: {
  memberId: string;
  mitgliedsnummer: string;
  anhaenge: Attachment[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!ALLOWED_MIME.has(file.type)) {
        throw new Error("Nur PDF, PNG oder JPG erlaubt.");
      }
      if (file.size > MAX_BYTES) {
        throw new Error("Datei zu groß (max. 10 MB).");
      }
      const ticket = await orpc.attachments.requestUploadUrl({
        memberId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const put = await fetch(ticket.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        throw new Error(`Upload zum Speicher fehlgeschlagen (${put.status}).`);
      }
      return orpc.attachments.finalize({ uploadId: ticket.uploadId });
    },
    onMutate: (file) => {
      setUploadError(null);
      setUploadingName(file.name);
    },
    onSuccess: async () => {
      setUploadingName(null);
      await refresh();
    },
    onError: (e: unknown) => {
      setUploadingName(null);
      setUploadError(e instanceof Error ? e.message : "Upload fehlgeschlagen.");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpc.attachments.remove({ id }),
    onSuccess: async () => {
      setPendingDeleteId(null);
      await refresh();
    },
    onError: () => setPendingDeleteId(null),
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Upload sequentially: each file goes through presign → S3 PUT →
    // finalize, and parallel finalize calls would race for the same
    // request-id range. `mutate` in a loop fires them all in parallel, so
    // await each one. Failures are collected and surfaced together at the
    // end (the per-mutation error state would otherwise be clobbered by the
    // next file's onMutate).
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      try {
        await upload.mutateAsync(f);
      } catch {
        failed.push(f.name);
      }
    }
    if (failed.length > 0) {
      setUploadError(`Upload fehlgeschlagen: ${failed.join(", ")}`);
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (!canEdit) return;
    void handleFiles(e.dataTransfer?.files ?? null);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    void handleFiles(e.target.files);
    e.target.value = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anhänge</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit ? (
          <label
            // Native label opens the native file picker on click/keyboard,
            // and the drop handlers below still work — best of both worlds
            // for accessibility plus drag-and-drop.
            htmlFor="attachment-file-input"
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/20 hover:bg-muted/30"
            }`}
          >
            <Upload className="size-5 text-muted-foreground" />
            <p className="text-muted-foreground">
              Datei hierher ziehen oder <span className="text-primary">auswählen</span>
            </p>
            <p className="text-xs text-muted-foreground">PDF, PNG, JPG · max. 10 MB</p>
            <input
              id="attachment-file-input"
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              onChange={onChange}
              className="hidden"
            />
            {uploadingName ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Lade hoch: {uploadingName}
              </p>
            ) : null}
            {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
          </label>
        ) : null}

        {anhaenge.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Anhänge.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {anhaenge.map((a) => {
              const isDeleting = pendingDeleteId === a.id;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a
                    href={`/api/files/${a.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-primary hover:underline"
                  >
                    <Paperclip className="size-4 shrink-0" />
                    <span className="truncate">{a.filename}</span>
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {(a.sizeBytes / 1024).toFixed(0)} KB · {formatDate(a.uploadedAt)}
                  </span>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(a)}
                      disabled={isDeleting}
                      aria-label={`Anhang "${a.filename}" löschen`}
                      title="Anhang löschen"
                    >
                      {isDeleting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4 text-destructive" />
                      )}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title="Anhang löschen?"
        description={
          confirmDelete ? `"${confirmDelete.filename}" wird dauerhaft entfernt.` : undefined
        }
        confirmLabel="Löschen"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          setPendingDeleteId(confirmDelete.id);
          remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </Card>
  );
}
