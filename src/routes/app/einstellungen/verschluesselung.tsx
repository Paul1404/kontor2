import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/verschluesselung")({
  component: EncryptionPage,
});

type Msg = { kind: "ok" | "error" | "info"; text: string };

function EncryptionPage() {
  const qc = useQueryClient();
  const inspect = useQuery({
    queryKey: ["encryption-inspect"],
    queryFn: () => orpc.settings.inspectEncryption(),
  });
  const [msg, setMsg] = useState<Msg | null>(null);

  const reencrypt = useMutation({
    mutationFn: () => orpc.settings.reencryptData(),
    onSuccess: (res) => {
      const t = res.totals;
      setMsg({
        kind: t.failed > 0 ? "error" : "ok",
        text:
          `Umschlüsselung fertig: ${t.rewritten} neu geschrieben, ${t.scanned} geprüft` +
          (t.failed > 0 ? `, ${t.failed} fehlgeschlagen.` : "."),
      });
      qc.invalidateQueries({ queryKey: ["encryption-inspect"] });
    },
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  const reports = inspect.data ?? [];
  const notOnCurrent = reports.reduce((a, r) => a + r.onPreviousKey + r.legacyV1 + r.unknown, 0);
  const total = reports.reduce((a, r) => a + r.total, 0);
  const safe = reports.length > 0 && notOnCurrent === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Verschlüsselung"
        description="Verschlüsselte Felder (IBANs, SMTP-Passwort) auf den aktuellen Schlüssel umschlüsseln. Der alte Schlüssel darf erst entfernt werden, wenn keine Zeile mehr auf ihm liegt."
      />

      {msg ? <MessageBanner msg={msg} onDismiss={() => setMsg(null)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Ob alle verschlüsselten Felder auf dem aktuellen Schlüssel liegen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inspect.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Lade …
            </div>
          ) : inspect.isError ? (
            <p className="text-sm text-destructive">{(inspect.error as Error).message}</p>
          ) : (
            <SafetyBanner safe={safe} notOnCurrent={notOnCurrent} total={total} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spalten</CardTitle>
          <CardDescription>
            Verteilung der Zeilen je verschlüsselter Spalte auf die Schlüssel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Spalte</th>
                  <th className="py-2 pr-4 text-right font-medium">Gesamt</th>
                  <th className="py-2 pr-4 text-right font-medium">Aktuell</th>
                  <th className="py-2 pr-4 text-right font-medium">Vorgänger</th>
                  <th className="py-2 pr-4 text-right font-medium">Legacy v1</th>
                  <th className="py-2 text-right font-medium">Unbekannt</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={`${r.table}.${r.column}`} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.table}.{r.column}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.total}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.onCurrentKey}</td>
                    <Cell value={r.onPreviousKey} />
                    <Cell value={r.legacyV1} />
                    <Cell value={r.unknown} last />
                  </tr>
                ))}
                {reports.length === 0 && !inspect.isPending ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-sm text-muted-foreground">
                      Keine verschlüsselten Felder gefunden.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
            <Button
              variant="outline"
              onClick={() => inspect.refetch()}
              disabled={inspect.isFetching}
            >
              {inspect.isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Aktualisieren
            </Button>
            <Button onClick={() => reencrypt.mutate()} disabled={reencrypt.isPending}>
              {reencrypt.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              Jetzt umschlüsseln
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Umschlüsseln ist idempotent: Zeilen, die schon auf dem aktuellen Schlüssel liegen,
            werden übersprungen. Fehlgeschlagene Zeilen bleiben unverändert und werden gemeldet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Cell({ value, last }: { value: number; last?: boolean }) {
  return (
    <td
      className={`py-2 text-right tabular-nums ${last ? "" : "pr-4"} ${
        value > 0 ? "font-semibold text-warning" : "text-muted-foreground"
      }`}
    >
      {value}
    </td>
  );
}

function SafetyBanner({
  safe,
  notOnCurrent,
  total,
}: {
  safe: boolean;
  notOnCurrent: number;
  total: number;
}) {
  if (safe) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <div>
          <div className="font-medium text-foreground">Alles auf dem aktuellen Schlüssel</div>
          <div className="text-muted-foreground">
            Alle {total} verschlüsselten Felder liegen auf dem aktuellen Schlüssel. Ein Vorgänger
            -Schlüssel darf jetzt entfernt werden.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <div className="font-medium text-foreground">
          {notOnCurrent} Feld(er) noch auf einem anderen Schlüssel
        </div>
        <div className="text-muted-foreground">
          Erst umschlüsseln, bevor ein alter Schlüssel entfernt wird. Sonst werden diese Felder
          unlesbar.
        </div>
      </div>
    </div>
  );
}

function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function MessageBanner({ msg, onDismiss }: { msg: Msg; onDismiss: () => void }) {
  const styles =
    msg.kind === "ok"
      ? "border-success/30 bg-success/10 text-foreground"
      : msg.kind === "error"
        ? "border-destructive/30 bg-destructive/10 text-foreground"
        : "border-border bg-muted text-foreground";
  const Icon = msg.kind === "ok" ? CheckCircle2 : msg.kind === "error" ? XCircle : ShieldCheck;
  const iconColor =
    msg.kind === "ok"
      ? "text-success"
      : msg.kind === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm shadow-soft ${styles}`}
      role="status"
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconColor}`} />
      <span className="flex-1 break-words">{msg.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        schließen
      </button>
    </div>
  );
}
