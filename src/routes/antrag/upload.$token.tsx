import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/antrag/upload/$token")({
  component: UploadPage,
});

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the "data:<mime>;base64," prefix; the server stores raw bytes.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function UploadPage() {
  const { token } = Route.useParams();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ["applications.uploadInfo", token],
    queryFn: () => orpc.applications.uploadInfo({ token }),
    retry: false,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 10 * 1024 * 1024) throw new Error("Datei zu groß (max. 10 MB).");
      const contentBase64 = await readAsBase64(file);
      return orpc.applications.uploadSigned({
        token,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
      });
    },
    onSuccess: () => setDone(true),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Upload fehlgeschlagen."),
  });

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Unterschriebene Beitrittserklärung hochladen</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {info.isError ? (
            <p className="text-destructive">
              Der Upload-Link ist ungültig oder abgelaufen. Bitte wenden Sie sich an den Verein.
            </p>
          ) : info.isLoading ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : done ? (
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" /> Vielen Dank. Ihr Dokument wurde hochgeladen.
            </div>
          ) : (
            <>
              <p className="text-muted-foreground">
                Antrag {info.data?.antragsnummer} für {info.data?.vorname} {info.data?.nachname}.
                Bitte laden Sie die unterschriebene Erklärung als PDF oder Foto hoch.
              </p>
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 hover:bg-muted/50">
                {upload.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Datei wählen
                <input
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (f) {
                      setErr(null);
                      upload.mutate(f);
                    }
                  }}
                />
              </label>
              {err ? <p className="text-destructive">{err}</p> : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
