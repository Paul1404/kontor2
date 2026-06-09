import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/antrag/papierformular")({
  component: PaperFormUpload,
});

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

function PaperFormUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ antragsnummer: string } | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Bitte zuerst eine Datei auswählen.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Datei zu groß (max. 20 MB).");
      const contentBase64 = await readAsBase64(file);
      return orpc.applications.submitPaperScan({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        email: email.trim() || null,
      });
    },
    onSuccess: (res) => setResult({ antragsnummer: res.antragsnummer }),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Upload fehlgeschlagen."),
  });

  if (result) {
    return (
      <Card className="motion-reveal-up">
        <CardContent className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-7" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Scan hochgeladen</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Vielen Dank. Der Verein hat Ihren Papier-Antrag erhalten und meldet sich bei Ihnen.
            Achten Sie bitte darauf, dass Ihre Kontaktdaten auf dem Scan gut lesbar sind.
          </p>
          <p className="text-sm">
            Vorgangsnummer <span className="font-mono font-semibold">{result.antragsnummer}</span>
          </p>
          <Link
            to="/antrag/status"
            search={{ nr: result.antragsnummer }}
            className="mt-1 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground shadow-soft transition-all hover:bg-accent"
          >
            <ArrowRight className="size-4" /> Status verfolgen
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Papier-Beitrittserklärung hochladen</CardTitle>
        <p className="text-sm text-muted-foreground">
          Sie haben die Beitrittserklärung bereits auf Papier ausgefüllt? Laden Sie hier einen Scan
          oder ein Foto der vollständig ausgefüllten und unterschriebenen Erklärung hoch. Sie müssen
          das Online-Formular dann nicht mehr ausfüllen.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-input border-dashed px-4 py-8 text-center text-muted-foreground transition-colors hover:bg-muted/40">
          {file ? (
            <>
              <FileText className="size-6 text-foreground" />
              <span className="font-medium text-foreground">{file.name}</span>
              <span className="text-xs">Andere Datei wählen</span>
            </>
          ) : (
            <>
              <Upload className="size-6" />
              <span>Scan oder Foto auswählen</span>
              <span className="text-xs">PDF, JPG, PNG oder HEIC, max. 20 MB</span>
            </>
          )}
          <input
            type="file"
            accept=".pdf,.heic,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setErr(null);
                setFile(f);
              }
            }}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paper-email">E-Mail-Adresse (optional)</Label>
          <Input
            id="paper-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.de"
          />
          <span className="text-xs text-muted-foreground">
            Mit Ihrer E-Mail senden wir Ihnen eine Eingangsbestätigung. Andernfalls meldet sich der
            Verein über die Angaben auf dem Papier-Antrag.
          </span>
        </div>

        {err ? <p className="text-destructive">{err}</p> : null}

        <Button
          type="button"
          className="self-start"
          disabled={!file || upload.isPending}
          onClick={() => {
            setErr(null);
            upload.mutate();
          }}
        >
          {upload.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Scan hochladen
        </Button>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Mit dem Hochladen bestätigen Sie, dass Sie auf dem Papier-Formular der Datenverarbeitung
          gemäß Datenschutzerklärung zugestimmt haben.
        </p>

        <p className="text-xs text-muted-foreground">
          Lieber digital ausfüllen?{" "}
          <Link to="/antrag" className="text-primary hover:underline">
            Zum Online-Formular
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
