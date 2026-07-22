import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Loader2, Plus, Power, PowerOff, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { formatDate, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/console/")({
  component: ConsoleVereinePage,
});

function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={
        active
          ? "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
          : "inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
      }
    >
      {active ? "Aktiv" : "Gesperrt"}
    </span>
  );
}

function DomainSettings({
  tenantKey,
  canonicalHost: initialCanonicalHost,
  legacyHosts: initialLegacyHosts,
  onSaved,
  onError,
}: {
  tenantKey: string;
  canonicalHost: string | null;
  legacyHosts: string[];
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [canonicalHost, setCanonicalHost] = useState(initialCanonicalHost ?? "");
  const [legacyHosts, setLegacyHosts] = useState(initialLegacyHosts.join("\n"));
  const save = useMutation({
    mutationFn: () =>
      orpc.console.updateRouting({
        key: tenantKey,
        canonicalHost,
        legacyHosts: legacyHosts
          .split(/[\n,]/)
          .map((host) => host.trim())
          .filter(Boolean),
      }),
    onSuccess: onSaved,
    onError: (err) => onError((err as Error).message),
  });

  return (
    <div className="grid min-w-[24rem] grid-cols-[1fr_1fr_auto] items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={`canonical-${tenantKey}`} className="text-xs">
          Kanonischer Host
        </Label>
        <Input
          id={`canonical-${tenantKey}`}
          value={canonicalHost}
          onChange={(event) => setCanonicalHost(event.target.value)}
          placeholder={`${tenantKey}.kontor2.com`}
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`legacy-${tenantKey}`} className="text-xs">
          Alte Domains
        </Label>
        <Textarea
          id={`legacy-${tenantKey}`}
          value={legacyHosts}
          onChange={(event) => setLegacyHosts(event.target.value)}
          placeholder="verwaltung.verein.de"
          rows={1}
          className="min-h-9 resize-y"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={save.isPending || !canonicalHost.trim()}
        onClick={() => save.mutate()}
      >
        {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        Speichern
      </Button>
    </div>
  );
}

function ConsoleVereinePage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["console.tenants"], queryFn: () => orpc.console.list() });

  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ key: string } | null>(null);
  const [confirmKey, setConfirmKey] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["console.tenants"] });

  const create = useMutation({
    mutationFn: () => orpc.console.create({ key: key.trim().toLowerCase(), displayName }),
    onSuccess: () => {
      setError(null);
      setKey("");
      setDisplayName("");
      refresh();
    },
    onError: (err) => setError((err as Error).message),
  });
  const setStatus = useMutation({
    mutationFn: (input: { key: string; status: "active" | "disabled" }) =>
      orpc.console.setStatus(input),
    onSuccess: refresh,
    onError: (err) => setError((err as Error).message),
  });
  const remove = useMutation({
    mutationFn: (input: { key: string; confirmKey: string }) => orpc.console.remove(input),
    onSuccess: () => {
      setPendingRemove(null);
      setConfirmKey("");
      refresh();
    },
    onError: (err) => setError((err as Error).message),
  });

  const domain = list.data?.productDomain ?? "kontor2.com";
  const primaryKey = list.data?.primaryKey;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Vereine</h1>
        <p className="text-sm text-muted-foreground">
          Mandanten anlegen und verwalten. Jeder Verein ist eigenständig.
        </p>
      </div>

      <InfoBox>
        Jeder Verein bekommt eine eigene Datenbank, eine eigene Subdomain (
        <code>name.{domain}</code>) und einen eigenen Verschlüsselungsschlüssel. Der erste Admin
        eines Vereins entsteht über <code>/setup</code> auf dessen Subdomain.
      </InfoBox>

      <Card>
        <CardHeader>
          <CardTitle>Verein anlegen</CardTitle>
          <CardDescription>
            Der Schlüssel ist die Subdomain (a-z, 0-9, Bindestrich), z. B.{" "}
            <code>tsv-musterstadt</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="tenant-key">Schlüssel / Subdomain</Label>
              <Input
                id="tenant-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="tsv-musterstadt"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="tenant-name">Anzeigename</Label>
              <Input
                id="tenant-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="TSV Musterstadt"
              />
            </div>
            <Button type="submit" disabled={create.isPending || !key.trim() || !displayName.trim()}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Anlegen
            </Button>
          </form>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bestehende Vereine</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isError ? (
            <div className="flex items-center justify-between gap-3 text-sm text-destructive">
              <span>{(list.error as Error).message}</span>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          ) : list.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Wird geladen…
            </div>
          ) : (list.data?.tenants.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Vereine angelegt.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Verein</th>
                    <th className="py-2 pr-3 font-medium">Datenbank</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Domains</th>
                    <th className="py-2 pr-3 font-medium">Angelegt</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {list.data?.tenants.map((t) => {
                    const isPrimary = t.key === primaryKey;
                    return (
                      <tr key={t.key} className="border-b last:border-0">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">
                            {orEmpty(t.displayName)}
                            {isPrimary ? (
                              <span className="ml-2 text-xs text-muted-foreground">(primär)</span>
                            ) : null}
                          </div>
                          <a
                            href={`https://${t.key}.${domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand"
                          >
                            {t.key}.{domain}
                            <ExternalLink className="size-3" />
                          </a>
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs">{orEmpty(t.databaseName)}</td>
                        <td className="py-2.5 pr-3">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <DomainSettings
                            tenantKey={t.key}
                            canonicalHost={t.canonicalHost}
                            legacyHosts={t.legacyHosts}
                            onSaved={() => {
                              setError(null);
                              refresh();
                            }}
                            onError={setError}
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">
                          {t.registered ? formatDate(t.createdAt) : "Primärinstanz"}
                        </td>
                        <td className="py-2.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isPrimary || setStatus.isPending}
                              onClick={() =>
                                setStatus.mutate({
                                  key: t.key,
                                  status: t.status === "active" ? "disabled" : "active",
                                })
                              }
                              aria-label={t.status === "active" ? "Sperren" : "Entsperren"}
                              title={
                                isPrimary
                                  ? "Primärer Verein"
                                  : t.status === "active"
                                    ? "Sperren"
                                    : "Entsperren"
                              }
                            >
                              {t.status === "active" ? (
                                <PowerOff className="size-4" />
                              ) : (
                                <Power className="size-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={isPrimary}
                              onClick={() => {
                                setConfirmKey("");
                                setPendingRemove({ key: t.key });
                              }}
                              aria-label="Entfernen"
                              title={isPrimary ? "Primärer Verein" : "Entfernen"}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title={`Verein "${pendingRemove?.key}" entfernen?`}
        description="Das löscht die Datenbank dieses Vereins unwiderruflich, inklusive aller Mitglieder und Daten. Zum Bestätigen den Schlüssel eintippen."
        destructive
        confirmLabel="Endgültig entfernen"
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingRemove) remove.mutate({ key: pendingRemove.key, confirmKey });
        }}
      >
        <Input
          value={confirmKey}
          onChange={(e) => setConfirmKey(e.target.value)}
          placeholder={pendingRemove?.key}
          autoCapitalize="none"
          spellCheck={false}
        />
      </ConfirmDialog>
    </div>
  );
}
