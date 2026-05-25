import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/portal/abgemeldet")({
  component: LoggedOutPage,
});

function LoggedOutPage() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <CheckCircle2 className="mx-auto size-10 text-success" />
      <h1 className="mt-4 text-xl font-semibold">Abgemeldet</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sie sind abgemeldet. Wenn Sie wieder auf das Portal zugreifen möchten, verwenden Sie den
        Einladungslink, den Ihnen der Verein zugeschickt hat. Bei Bedarf erstellt die
        Geschäftsstelle einen neuen Link.
      </p>
    </div>
  );
}
