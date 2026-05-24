import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Layers, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/abteilungen")({
  component: AbteilungenSettingsPage,
});

function AbteilungenSettingsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["abteilungen.list"],
    queryFn: () => orpc.abteilungen.list(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["abteilungen.list"] });

  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => orpc.abteilungen.create({ name: newName.trim() }),
    onSuccess: async () => {
      setNewName("");
      setCreateError(null);
      await refresh();
    },
    onError: (e: unknown) => setCreateError(e instanceof Error ? e.message : "Fehler"),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      orpc.abteilungen.rename({ id, name: name.trim() }),
    onSuccess: async () => {
      setEditingId(null);
      setActionError(null);
      await refresh();
    },
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : "Fehler"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpc.abteilungen.delete({ id }),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : "Fehler"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Layers className="size-6 text-brand" /> Abteilungen
        </h1>
        <p className="text-sm text-muted-foreground">
          Sportabteilungen oder Sparten des Vereins. Mitglieder werden auf der Mitgliederseite
          zugeordnet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Neue Abteilung</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate();
            }}
          >
            <div className="flex min-w-60 flex-1 flex-col gap-1.5">
              <label
                htmlFor="abt-name"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Name
              </label>
              <Input
                id="abt-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="z. B. Fußball"
                maxLength={80}
              />
            </div>
            <Button type="submit" disabled={!newName.trim() || create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Anlegen
            </Button>
          </form>
          {createError ? <p className="mt-2 text-sm text-destructive">{createError}</p> : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold">
          Alle Abteilungen
        </div>
        {actionError ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {actionError}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 text-right font-medium">Aktiv</th>
                <th className="px-4 py-3 text-right font-medium">Gesamt</th>
                <th className="px-4 py-3 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Wird geladen…
                    </span>
                  </td>
                </tr>
              ) : !list.data || list.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Noch keine Abteilungen.
                  </td>
                </tr>
              ) : (
                list.data.map((a) => {
                  const isEditing = editingId === a.id;
                  const canDelete = a.totalCount === 0;
                  return (
                    <tr key={a.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        {isEditing ? (
                          <Input
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            maxLength={80}
                          />
                        ) : (
                          a.name
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                        {a.slug}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.memberCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.totalCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => rename.mutate({ id: a.id, name: editDraft })}
                                disabled={!editDraft.trim() || rename.isPending}
                              >
                                {rename.isPending ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Check className="size-4" />
                                )}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                <X className="size-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingId(a.id);
                                  setEditDraft(a.name);
                                  setActionError(null);
                                }}
                                title="Umbenennen"
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (window.confirm(`Abteilung "${a.name}" löschen?`)) {
                                    remove.mutate(a.id);
                                  }
                                }}
                                disabled={!canDelete || remove.isPending}
                                title={
                                  canDelete ? "Löschen" : "Erst alle Mitgliedschaften entfernen"
                                }
                              >
                                <Trash2
                                  className={`size-4 ${canDelete ? "text-destructive" : "text-muted-foreground"}`}
                                />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
