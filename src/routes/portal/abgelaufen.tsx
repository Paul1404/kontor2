import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/portal/abgelaufen")({
  component: ExpiredPage,
});

function ExpiredPage() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <AlertTriangle className="mx-auto size-10 text-warning" />
      <h1 className="mt-4 text-xl font-semibold">Zugang abgelaufen</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Der Einladungslink ist abgelaufen oder bereits widerrufen worden. Bitte fordern Sie bei der
        Geschäftsstelle einen neuen Link an.
      </p>
    </div>
  );
}
