import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatDate } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

type Beziehung = {
  id: string;
  beziehung: string | null;
  notiz: string | null;
  datVon: string | Date | null;
  datBis: string | Date | null;
  istVertreter: boolean;
  toMemberId: string | null;
  toAdrNr: number;
  fallbackName: string | null;
  toMitglnr: string | null;
  toVorname: string | null;
  toNachname: string | null;
};

type TargetSearchHit = {
  id: string;
  mitgliedsnummer: string | null;
  vorname: string | null;
  nachname: string | null;
  plz: string | null;
  ort: string | null;
};

/** Coerce a stored date (Date or ISO string) to the YYYY-MM-DD a date input wants. */
function toDateInput(v: string | Date | null): string {
  if (!v) return "";
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

export function BeziehungenCard({
  memberId,
  mitgliedsnummer,
  beziehungen,
  canEdit,
}: {
  memberId: string;
  mitgliedsnummer: string;
  beziehungen: Beziehung[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] }),
      qc.invalidateQueries({ queryKey: ["members.get"] }),
    ]);

  // Per-row pending state — see ContractsCard for the same pattern.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => orpc.relationships.remove({ id, removeReciprocal: true }),
    onSuccess: async () => {
      setPendingDeleteId(null);
      setConfirmTarget(null);
      await refresh();
    },
    onError: () => {
      setPendingDeleteId(null);
      setConfirmTarget(null);
    },
  });

  // Toggle which connection is the legal representative (Mahnung recipient for
  // a minor). The server clears the flag on the member's other connections.
  const [pendingVertreterId, setPendingVertreterId] = useState<string | null>(null);
  const setVertreter = useMutation({
    mutationFn: (args: { id: string; value: boolean }) =>
      orpc.relationships.update({ id: args.id, patch: { istVertreter: args.value } }),
    onMutate: (args) => setPendingVertreterId(args.id),
    onSettled: async () => {
      setPendingVertreterId(null);
      await refresh();
    },
  });

  // Inline edit of a connection's metadata (kind, note, dates). The vertreter
  // flag stays on its own toggle button; this form covers the rest, which had
  // no UI before even though the update procedure already accepted them.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ beziehung: "", notiz: "", datVon: "", datBis: "" });
  const editRelation = useMutation({
    mutationFn: (args: {
      id: string;
      patch: {
        beziehung: string | null;
        notiz: string | null;
        datVon: string | null;
        datBis: string | null;
      };
    }) => orpc.relationships.update({ id: args.id, patch: args.patch }),
    onSuccess: async () => {
      setEditingId(null);
      await refresh();
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Beziehungen</CardTitle>
        {canEdit ? (
          adding ? null : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Hinzufügen
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding && canEdit ? (
          <AddRelationshipForm
            memberId={memberId}
            onCancel={() => setAdding(false)}
            onCreated={async () => {
              setAdding(false);
              await refresh();
            }}
          />
        ) : null}

        {beziehungen.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Beziehungen erfasst.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {beziehungen.map((b) => {
              const name =
                [b.toVorname, b.toNachname].filter(Boolean).join(" ") ||
                b.fallbackName ||
                `AdrNr ${b.toAdrNr}`;
              if (editingId === b.id && canEdit) {
                return (
                  <li key={b.id} className="flex flex-col gap-3 py-3">
                    <span className="text-sm font-medium">{name}</span>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Beziehungsart
                        </Label>
                        <Input
                          value={editDraft.beziehung}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, beziehung: e.target.value })
                          }
                          placeholder="z. B. Familienmitglied"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Notiz
                        </Label>
                        <Input
                          value={editDraft.notiz}
                          onChange={(e) => setEditDraft({ ...editDraft, notiz: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Von
                        </Label>
                        <Input
                          type="date"
                          value={editDraft.datVon}
                          onChange={(e) => setEditDraft({ ...editDraft, datVon: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Bis
                        </Label>
                        <Input
                          type="date"
                          value={editDraft.datBis}
                          onChange={(e) => setEditDraft({ ...editDraft, datBis: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                        disabled={editRelation.isPending}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={editRelation.isPending}
                        onClick={() =>
                          editRelation.mutate({
                            id: b.id,
                            patch: {
                              beziehung: editDraft.beziehung.trim() || null,
                              notiz: editDraft.notiz.trim() || null,
                              datVon: editDraft.datVon || null,
                              datBis: editDraft.datBis || null,
                            },
                          })
                        }
                      >
                        {editRelation.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        Speichern
                      </Button>
                    </div>
                  </li>
                );
              }
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      {b.toMemberId ? (
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: b.toMitglnr ?? String(b.toAdrNr) }}
                          className="font-medium text-primary hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium text-muted-foreground">{name}</span>
                      )}
                      {b.beziehung ? <Badge variant="secondary">{b.beziehung}</Badge> : null}
                      {b.toMemberId && !b.toMitglnr ? (
                        <Badge variant="outline" title="Zahler/Kontakt, kein Mitglied">
                          Kontakt
                        </Badge>
                      ) : null}
                      {b.istVertreter ? (
                        <Badge className="gap-1" title="Empfänger für Mahnungen bei Minderjährigen">
                          <ShieldCheck className="size-3" /> Vertretung
                        </Badge>
                      ) : null}
                    </div>
                    {b.notiz ? <p className="text-xs text-muted-foreground">{b.notiz}</p> : null}
                    {b.datVon || b.datBis ? (
                      <p className="text-xs text-muted-foreground">
                        {b.datVon ? `Von ${formatDate(b.datVon)}` : ""}
                        {b.datBis ? ` · Bis ${formatDate(b.datBis)}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditDraft({
                            beziehung: b.beziehung ?? "",
                            notiz: b.notiz ?? "",
                            datVon: toDateInput(b.datVon),
                            datBis: toDateInput(b.datBis),
                          });
                          setEditingId(b.id);
                        }}
                        aria-label="Beziehung bearbeiten"
                        title="Bearbeiten"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant={b.istVertreter ? "secondary" : "ghost"}
                        onClick={() => setVertreter.mutate({ id: b.id, value: !b.istVertreter })}
                        disabled={pendingVertreterId === b.id}
                        title={
                          b.istVertreter
                            ? "Als Vertretung entfernen"
                            : "Als gesetzliche Vertretung (Mahnungs-Empfänger) festlegen"
                        }
                      >
                        {pendingVertreterId === b.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ShieldCheck
                            className={b.istVertreter ? "size-4 text-primary" : "size-4"}
                          />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmTarget({ id: b.id, name })}
                        disabled={pendingDeleteId === b.id}
                        aria-label="Beziehung entfernen"
                        title="Beziehung entfernen"
                      >
                        {pendingDeleteId === b.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setConfirmTarget(null);
        }}
        aria-label="Beziehung entfernen"
        title="Beziehung entfernen"
        description={confirmTarget ? `Beziehung zu ${confirmTarget.name} entfernen?` : ""}
        confirmLabel="Entfernen"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (confirmTarget) {
            setPendingDeleteId(confirmTarget.id);
            remove.mutate(confirmTarget.id);
          }
        }}
      />
    </Card>
  );
}

function AddRelationshipForm({
  memberId,
  onCancel,
  onCreated,
}: {
  memberId: string;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TargetSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TargetSearchHit | null>(null);
  const [kind, setKind] = useState("Familienmitglied");
  const [reciprocal, setReciprocal] = useState(true);
  const [notiz, setNotiz] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kindId = useId();
  const notizId = useId();

  const search = useMutation({
    mutationFn: (query: string) =>
      orpc.relationships.searchTargets({ q: query, excludeMemberId: memberId }),
    onMutate: () => setSearching(true),
    onSuccess: (data) => {
      setHits(data);
      setSearching(false);
    },
    onError: () => setSearching(false),
  });

  const create = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Bitte ein Zielmitglied auswählen.");
      return orpc.relationships.create({
        fromMemberId: memberId,
        toMemberId: selected.id,
        beziehung: kind.trim() || null,
        notiz: notiz.trim() || null,
        reciprocal,
      });
    },
    onSuccess: () => onCreated(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Zielmitglied suchen
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (q.trim().length >= 2) search.mutate(q.trim());
                }
              }}
              placeholder="Name oder Mitgliedsnummer"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => q.trim().length >= 2 && search.mutate(q.trim())}
            disabled={searching || q.trim().length < 2}
          >
            {searching ? <Loader2 className="size-4 animate-spin" /> : "Suchen"}
          </Button>
        </div>
        {hits.length > 0 && !selected ? (
          <ul className="max-h-44 overflow-auto rounded-md border border-border bg-card text-sm">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted"
                  onClick={() => {
                    setSelected(h);
                    setHits([]);
                  }}
                >
                  <span className="font-medium">
                    {[h.nachname, h.vorname].filter(Boolean).join(", ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {memberRef(h)} {h.plz ?? ""} {h.ort ?? ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {selected ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
            <span>
              <span className="font-medium">
                {[selected.nachname, selected.vorname].filter(Boolean).join(", ")}
              </span>{" "}
              <span className="text-muted-foreground">{selected.mitgliedsnummer}</span>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={kindId} className="text-xs uppercase tracking-wide text-muted-foreground">
            Beziehungsart
          </Label>
          <Input
            id={kindId}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="z. B. Familienmitglied"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={notizId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Notiz
          </Label>
          <Input id={notizId} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={reciprocal}
          onChange={(e) => setReciprocal(e.target.checked)}
          className="size-4 accent-primary"
        />
        Spiegelbeziehung beim Zielmitglied ebenfalls anlegen
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setError(null);
            create.mutate();
          }}
          disabled={create.isPending || !selected}
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Verknüpfen
        </Button>
      </div>
    </div>
  );
}
