import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Keine Datei ausgewählt.");
      const contentBase64 = await fileToBase64(file);
      return orpc.import.uploadSqlDump({ filename: file.name, contentBase64 });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Linear Webverein Import</h1>
        <p className="text-sm text-muted-foreground">
          SQL-Dump (mysqldump-Format) hochladen. Maximalgröße 50 MB.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datei hochladen</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            type="file"
            accept=".sql,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm"
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
              <Upload className="size-4" />
              {upload.isPending ? "Wird verarbeitet..." : "Importieren"}
            </Button>
            {file ? (
              <span className="text-sm text-muted-foreground">
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {upload.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            Fehler: {(upload.error as Error).message}
          </CardContent>
        </Card>
      ) : null}

      {upload.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Import abgeschlossen</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="flex flex-col gap-1">
              <li>Batch-ID: <span className="tabular-nums">{upload.data.batchId}</span></li>
              <li>Mitglieder geschrieben: {upload.data.membersWritten} (neu: {upload.data.membersCreated}, geändert: {upload.data.membersUpdated})</li>
              <li>Beitragsarten: {upload.data.feeTypesWritten}</li>
              <li>Verträge: {upload.data.contractsWritten}</li>
              <li>SEPA-Mandate: {upload.data.sepaWritten}</li>
              <li>Abteilungs-Mitgliedschaften: {upload.data.abteilungenLinked}</li>
            </ul>
            {upload.data.errors.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-amber-600">
                  {upload.data.errors.length} Warnungen
                </summary>
                <ul className="mt-1 list-disc pl-5">
                  {upload.data.errors.slice(0, 25).map((err, idx) => (
                    <li key={idx} className="text-xs">
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
