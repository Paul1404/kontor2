import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/import")({
  component: ImportPage,
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result as string;
      const idx = result.indexOf(",");
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(file);
  });
}

function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [forceOverwriteAbteilungLinks, setForceOverwriteAbteilungLinks] = useState(false);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Keine Datei ausgewählt.");
      const contentBase64 = await fileToBase64(file);
      return orpc.import.uploadSqlDump({
        filename: file.name,
        contentBase64,
        forceOverwriteAbteilungLinks,
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Linear Webverein Import</h1>
        <p className="text-sm text-muted-foreground">
          SQL-Dump (mysqldump-Format) hochladen. Maximalgröße 50 MB.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datei hochladen</CardTitle>
          <CardDescription>
            Der Inhalt wird normalisiert und in das aktuelle Schema überführt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:bg-muted/50">
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm">
              <span className="font-medium text-foreground">Klicken zum Auswählen</span>
              <span className="text-muted-foreground"> oder Datei hier ablegen</span>
            </span>
            <span className="text-xs text-muted-foreground">.sql · max. 50 MB</span>
            <input
              type="file"
              accept=".sql,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
          {file ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-card/50 p-3 text-sm">
            <input
              type="checkbox"
              checked={forceOverwriteAbteilungLinks}
              onChange={(e) => setForceOverwriteAbteilungLinks(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Abteilungs-Zuordnungen aus Linear überschreiben</span>
              <span className="text-xs text-muted-foreground">
                Vorhandene Abteilungs-Mitgliedschaften der importierten Mitglieder werden gelöscht
                und exakt nach Linear neu angelegt. Manuell ergänzte Zuordnungen gehen verloren.
                Stammdaten, Verträge und SEPA werden ohnehin immer überschrieben.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
              {upload.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {upload.isPending ? "Wird verarbeitet..." : "Importieren"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {upload.isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm shadow-soft">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>Fehler: {(upload.error as Error).message}</span>
        </div>
      ) : null}

      {upload.data ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" />
              <CardTitle>Import abgeschlossen</CardTitle>
            </div>
            <CardDescription>
              Batch-ID: <span className="font-mono tabular-nums">{upload.data.batchId}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <li>
                Mitglieder geschrieben:{" "}
                <span className="font-medium tabular-nums">{upload.data.membersWritten}</span>{" "}
                <span className="text-muted-foreground">
                  (neu: {upload.data.membersCreated}, geändert: {upload.data.membersUpdated})
                </span>
              </li>
              <li>
                Beitragsarten:{" "}
                <span className="font-medium tabular-nums">{upload.data.feeTypesWritten}</span>
              </li>
              <li>
                Verträge:{" "}
                <span className="font-medium tabular-nums">{upload.data.contractsWritten}</span>
              </li>
              <li>
                SEPA-Mandate:{" "}
                <span className="font-medium tabular-nums">{upload.data.sepaWritten}</span>
              </li>
              <li>
                Abteilungs-Mitgliedschaften:{" "}
                <span className="font-medium tabular-nums">{upload.data.abteilungenLinked}</span>
              </li>
            </ul>
            {upload.data.errors.length > 0 ? (
              <details className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                <summary className="cursor-pointer text-sm text-warning">
                  {upload.data.errors.length} Warnungen
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {upload.data.errors.slice(0, 25).map((err, idx) => (
                    <li key={idx}>
                      [{err.table}] {err.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
