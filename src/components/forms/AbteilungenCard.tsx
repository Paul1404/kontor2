import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Loader2, LogOut, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export type MemberAbteilung = {
  id: string;
  name: string;
  eintrittsdatum: string | Date;
  austrittsdatum: string | Date | null;
};

export function AbteilungenCard({
  memberId,
  mitgliedsnummer,
  abteilungen,
  canEdit,
}: {
  memberId: string;
  mitgliedsnummer: string;
  abteilungen: MemberAbteilung[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Abteilungen</CardTitle>
        {canEdit && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Hinzufügen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {adding && canEdit ? (
          <AddForm
            memberId={memberId}
            existingAbteilungIds={abteilungen.filter((a) => !a.austrittsdatum).map((a) => a.id)}
            onCancel={() => setAdding(false)}
            onCreated={async () => {
              setAdding(false);
              await refresh();
            }}
          />
        ) : null}

        {abteilungen.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Abteilungszuordnung.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {abteilungen.map((a) => (
              <Row
                key={`${a.id}-${typeof a.eintrittsdatum === "string" ? a.eintrittsdatum : a.eintrittsdatum.toISOString()}`}
                memberId={memberId}
                row={a}
                canEdit={canEdit}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function toDateString(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function Row({
  memberId,
  row,
  canEdit,
  onChanged,
}: {
  memberId: string;
  row: MemberAbteilung;
  canEdit: boolean;
  onChanged: () => Promise<unknown> | unknown;
}) {
  const eintrittsdatum = toDateString(row.eintrittsdatum);
  const [editingAustritt, setEditingAustritt] = useState(false);
  const [austrittDraft, setAustrittDraft] = useState(
    row.austrittsdatum ? toDateString(row.austrittsdatum) : new Date().toISOString().slice(0, 10),
  );

  const setAustritt = useMutation({
    mutationFn: (austrittsdatum: string | null) =>
      orpc.abteilungen.setMemberAustritt({
        memberId,
        abteilungId: row.id,
        eintrittsdatum,
        austrittsdatum,
      }),
    onSuccess: async () => {
      setEditingAustritt(false);
      await onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      orpc.abteilungen.removeMember({ memberId, abteilungId: row.id, eintrittsdatum }),
    onSuccess: () => onChanged(),
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="flex flex-col">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground">
          Eintritt {formatDate(row.eintrittsdatum)}
          {row.austrittsdatum ? ` · Austritt ${formatDate(row.austrittsdatum)}` : ""}
        </span>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-1">
          {editingAustritt ? (
            <>
              <input
                type="date"
                value={austrittDraft}
                onChange={(e) => setAustrittDraft(e.target.value)}
                className="h-8 rounded-md border border-input bg-card px-2 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAustritt.mutate(austrittDraft)}
                disabled={setAustritt.isPending}
              >
                {setAustritt.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Speichern"
                )}
              </Button>
              {row.austrittsdatum ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAustritt.mutate(null)}
                  title="Austrittsdatum entfernen"
                  disabled={setAustritt.isPending}
                >
                  Zurücksetzen
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setEditingAustritt(false)}>
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingAustritt(true)}
                title="Austritt eintragen"
              >
                {row.austrittsdatum ? (
                  <Calendar className="size-4" />
                ) : (
                  <LogOut className="size-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Mitgliedschaft in "${row.name}" entfernen?`)) {
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
                title="Mitgliedschaft entfernen"
              >
                {remove.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4 text-destructive" />
                )}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function AddForm({
  memberId,
  existingAbteilungIds,
  onCancel,
  onCreated,
}: {
  memberId: string;
  existingAbteilungIds: string[];
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const abteilungenAll = useQuery({
    queryKey: ["abteilungen", "list"],
    queryFn: () => orpc.abteilungen.list(),
  });

  const [abteilungId, setAbteilungId] = useState("");
  const [eintrittsdatum, setEintrittsdatum] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      orpc.abteilungen.assignMember({
        memberId,
        abteilungId,
        eintrittsdatum,
      }),
    onSuccess: () => onCreated(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Anlage fehlgeschlagen."),
  });

  const options = (abteilungenAll.data ?? []).filter((a) => !existingAbteilungIds.includes(a.id));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <label
          htmlFor="add-abteilung-select"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Abteilung
        </label>
        <select
          id="add-abteilung-select"
          value={abteilungId}
          onChange={(e) => setAbteilungId(e.target.value)}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm"
        >
          <option value="">Bitte wählen…</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="add-abteilung-eintritt"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Eintritt
        </label>
        <input
          id="add-abteilung-eintritt"
          type="date"
          value={eintrittsdatum}
          onChange={(e) => setEintrittsdatum(e.target.value)}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
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
          disabled={!abteilungId || create.isPending}
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Zuordnen
        </Button>
      </div>
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
