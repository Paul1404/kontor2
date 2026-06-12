import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Loader2, Power, PowerOff, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { CopyButton } from "~/components/ui/copy-button";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryErrorRow } from "~/components/ui/query-error";
import { formatDate, formatDateTime, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/ki-zugriff")({
  component: ApiKeysPage,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  vorstand: "Vorstand",
  readonly: "Readonly",
};

function ApiKeysPage() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["apiKeys"], queryFn: () => orpc.apiKeys.list() });
  const users = useQuery({ queryKey: ["users"], queryFn: () => orpc.auth.listUsers() });

  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  // Readonly by default: a write-capable key (bound to a vorstand/admin user)
  // requires this explicit opt-in (issue #83).
  const [allowWrite, setAllowWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; name: string | null } | null>(
    null,
  );

  // The connection snippets need the deployed origin; window only exists in
  // the browser, so resolve it after mount.
  const [origin, setOrigin] = useState("https://<host>");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const create = useMutation({
    mutationFn: () =>
      orpc.apiKeys.create({
        name,
        userId,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        allowWrite,
      }),
    onSuccess: (data) => {
      setError(null);
      setCreatedKey({ name: data.name ?? name, key: data.key });
      setName("");
      setExpiresInDays("");
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const revoke = useMutation({
    mutationFn: (input: { id: string }) => orpc.apiKeys.revoke(input),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const setEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => orpc.apiKeys.setEnabled(input),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const mcpUrl = `${origin}/api/mcp`;
  const claudeCodeCommand = `claude mcp add --transport http kontor2 ${mcpUrl} --header "x-api-key: <SCHLÜSSEL>"`;
  const desktopConfig = `{
  "mcpServers": {
    "kontor2": {
      "command": "npx",
      "args": [
        "mcp-remote@latest",
        "${mcpUrl}",
        "--header",
        "x-api-key: <SCHLÜSSEL>"
      ]
    }
  }
}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">KI-Zugriff (MCP)</h1>
        <p className="text-sm text-muted-foreground">
          Zugriffsschlüssel für KI-Assistenten wie Claude. Ein Schlüssel handelt mit den Rechten des
          verknüpften Benutzers.
        </p>
      </div>

      <InfoBox title="Wie funktioniert der Zugriff?" collapsible defaultOpen={false}>
        <p>
          Die Vereinsverwaltung stellt unter <code className="text-xs">/api/mcp</code> eine
          MCP-Schnittstelle (Model Context Protocol) bereit. Ein verbundener KI-Assistent kann damit
          Mitglieder suchen, Berichte und Forderungen abrufen und je nach Rolle auch Daten ändern.
        </p>
        <ul className="mt-3 space-y-1.5">
          <li>
            <strong>Readonly</strong>: nur lesende Werkzeuge (Suche, Berichte, Statistiken).
          </li>
          <li>
            <strong>Vorstand</strong>: zusätzlich Mitglieder anlegen und bearbeiten, Aufgaben
            verwalten, Forderungen als bezahlt markieren.
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Beitrags- und Mahnläufe, SEPA, Einstellungen und der Adminbereich sind über MCP bewusst
          nicht erreichbar. Jede Änderung wird wie gewohnt im Audit-Protokoll erfasst.
        </p>
      </InfoBox>

      <Card>
        <CardHeader>
          <CardTitle>Schlüssel erstellen</CardTitle>
          <CardDescription>
            Der Schlüssel erhält die Rolle des gewählten Benutzers. Standardmäßig sind nur
            Readonly-Benutzer wählbar. Für einen schreibfähigen Schlüssel den Schreibzugriff
            ausdrücklich erlauben.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setCreatedKey(null);
              create.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                required
                maxLength={32}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-56"
                placeholder="z. B. Claude Vorstand"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-user">Benutzer</Label>
              <select
                id="key-user"
                required
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="h-10 w-72 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="" disabled>
                  Benutzer wählen…
                </option>
                {users.data
                  ?.filter((u) => !u.banned)
                  // Without the write opt-in, only readonly users are
                  // selectable, so a new key is readonly by default.
                  .filter((u) => allowWrite || u.role === "readonly")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({ROLE_LABEL[u.role] ?? u.role})
                    </option>
                  ))}
              </select>
            </div>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={allowWrite}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAllowWrite(next);
                  // Clear a now-disallowed selection when turning write access off.
                  if (!next) {
                    const selected = users.data?.find((u) => u.id === userId);
                    if (selected && selected.role !== "readonly") setUserId("");
                  }
                }}
              />
              Schreibzugriff erlauben
            </label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-expiry">Gültig (Tage, optional)</Label>
              <Input
                id="key-expiry"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                className="w-44"
                placeholder="unbegrenzt"
              />
            </div>
            <Button type="submit" disabled={create.isPending || !userId}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Erstellen
            </Button>
          </form>

          {createdKey ? (
            <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-4">
              <p className="text-sm font-medium">Schlüssel "{createdKey.name}" erstellt.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="break-all rounded bg-card px-2 py-1 text-xs">
                  {createdKey.key}
                </code>
                <CopyButton value={createdKey.key} label="Schlüssel" />
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert className="size-3.5 shrink-0" />
                Der Schlüssel wird nur einmal angezeigt. Jetzt kopieren und sicher ablegen.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm shadow-soft">
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="break-words">{error}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle>Aktive Schlüssel</CardTitle>
          <CardDescription>Alle ausgegebenen Schlüssel. Widerruf wirkt sofort.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Benutzer</th>
                  <th className="px-4 py-3 font-medium">Rolle</th>
                  <th className="px-4 py-3 font-medium">Beginnt mit</th>
                  <th className="px-4 py-3 font-medium">Letzte Nutzung</th>
                  <th className="px-4 py-3 font-medium">Gültig bis</th>
                  <th className="px-4 py-3 font-medium" aria-label="Aktionen" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keys.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Wird geladen…
                    </td>
                  </tr>
                ) : keys.isError ? (
                  <QueryErrorRow colSpan={7} onRetry={() => keys.refetch()} />
                ) : keys.data && keys.data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Noch keine Schlüssel.
                    </td>
                  </tr>
                ) : (
                  keys.data?.map((k) => (
                    <tr key={k.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {orEmpty(k.name)}
                          {k.enabled === false ? (
                            <span className="rounded-md border border-transparent bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Deaktiviert
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{k.userEmail}</td>
                      <td className="px-4 py-3">{ROLE_LABEL[k.userRole] ?? k.userRole}</td>
                      <td className="px-4 py-3">
                        <code className="text-xs">{orEmpty(k.start)}</code>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {k.lastRequest ? formatDateTime(k.lastRequest) : orEmpty(null)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {k.expiresAt ? formatDate(k.expiresAt) : "unbegrenzt"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={
                              k.enabled === false
                                ? `Schlüssel ${k.name ?? ""} aktivieren`
                                : `Schlüssel ${k.name ?? ""} deaktivieren`
                            }
                            title={k.enabled === false ? "Aktivieren" : "Deaktivieren"}
                            disabled={setEnabled.isPending && setEnabled.variables?.id === k.id}
                            onClick={() =>
                              setEnabled.mutate({ id: k.id, enabled: k.enabled === false })
                            }
                          >
                            {setEnabled.isPending && setEnabled.variables?.id === k.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : k.enabled === false ? (
                              <Power className="size-4 text-success" />
                            ) : (
                              <PowerOff className="size-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Schlüssel ${k.name ?? ""} widerrufen`}
                            title="Widerrufen"
                            onClick={() => setPendingRevoke({ id: k.id, name: k.name })}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verbindung einrichten</CardTitle>
          <CardDescription>
            Den Platzhalter durch den erstellten Schlüssel ersetzen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Claude Code</p>
              <CopyButton value={claudeCodeCommand} label="Befehl" />
            </div>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs">
              {claudeCodeCommand}
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Claude Desktop</p>
              <CopyButton value={desktopConfig} label="Konfiguration" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Claude Desktop kann in den Connector-Einstellungen keine eigenen Header senden.
              Stattdessen diesen Block in die Datei{" "}
              <code className="text-xs">claude_desktop_config.json</code> eintragen (benötigt
              Node.js):
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs">
              {desktopConfig}
            </pre>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRevoke(null);
        }}
        title="Schlüssel widerrufen?"
        description={
          pendingRevoke
            ? `Der Schlüssel "${pendingRevoke.name ?? "ohne Namen"}" funktioniert danach sofort nicht mehr.`
            : undefined
        }
        confirmLabel="Widerrufen"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (!pendingRevoke) return;
          revoke.mutate({ id: pendingRevoke.id });
          setPendingRevoke(null);
        }}
      />
    </div>
  );
}
