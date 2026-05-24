import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Contract = {
  id: string;
  vertragNr: string;
  art: number;
  artName: string | null;
  betrag: string | null;
  vertragBegin: string | Date | null;
  vertragEnde: string | Date | null;
  gekuendAm: string | Date | null;
};

export function ContractsCard({
  memberId,
  mitgliedsnummer,
  vertraege,
  canEdit,
}: {
  memberId: string;
  mitgliedsnummer: string;
  vertraege: Contract[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });

  // Track which specific row is being deleted so the spinner / disabled
  // state only applies to that one row, not every Trash icon in the table.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => orpc.contracts.remove({ id }),
    onSuccess: async () => {
      setPendingDeleteId(null);
      await refresh();
    },
    onError: () => setPendingDeleteId(null),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Verträge</CardTitle>
        {canEdit && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Hinzufügen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding && canEdit ? (
          <AddContractForm
            memberId={memberId}
            existingArt={vertraege.map((v) => v.art)}
            onCancel={() => setAdding(false)}
            onCreated={async () => {
              setAdding(false);
              await refresh();
            }}
          />
        ) : null}

        {vertraege.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Verträge.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Vertrag</th>
                <th className="py-1 pr-3">Art</th>
                <th className="py-1 pr-3 text-right">Betrag</th>
                <th className="py-1 px-3">Beginn</th>
                <th className="py-1 px-3">Ende</th>
                {canEdit ? <th className="py-1 w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {vertraege.map((v) => {
                const isDeleting = pendingDeleteId === v.id;
                return (
                  <tr key={v.id} className="border-t">
                    <td className="py-1 pr-3 tabular-nums">{v.vertragNr}</td>
                    <td className="py-1 pr-3">{v.artName ?? v.art}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {formatCurrency(v.betrag)}
                    </td>
                    <td className="py-1 px-3 text-muted-foreground tabular-nums">
                      {formatDate(v.vertragBegin)}
                    </td>
                    <td className="py-1 px-3 text-muted-foreground tabular-nums">
                      {formatDate(v.vertragEnde) ||
                        (v.gekuendAm ? formatDate(v.gekuendAm) : "")}
                    </td>
                    {canEdit ? (
                      <td className="py-1 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Vertrag ${v.vertragNr} (${v.artName ?? v.art}) löschen?`,
                              )
                            ) {
                              setPendingDeleteId(v.id);
                              remove.mutate(v.id);
                            }
                          }}
                          disabled={isDeleting}
                          title="Vertrag löschen"
                        >
                          {isDeleting ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4 text-destructive" />
                          )}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function AddContractForm({
  memberId,
  existingArt,
  onCancel,
  onCreated,
}: {
  memberId: string;
  existingArt: number[];
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  // Pull the globally configured Beitragsarten so the user picks one
  // instead of typing free-form data. The form is intentionally minimal:
  // pick a type → date → done. Betrag and Bezeichnung come from settings.
  const feeTypes = useQuery({
    queryKey: ["feeTypes.list"],
    queryFn: () => orpc.feeTypes.list(),
  });

  const [vertragNr, setVertragNr] = useState("");
  const [art, setArt] = useState<string>("");
  const [vertragBegin, setVertragBegin] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  // Hide inactive Beitragsarten and anything the member already has.
  const options = (feeTypes.data ?? []).filter(
    (f) => f.nichAktiv !== "J" && !existingArt.includes(f.art),
  );
  const selected = options.find((f) => String(f.art) === art) ?? null;

  const create = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Bitte eine Beitragsart wählen.");
      if (!vertragNr.trim()) throw new Error("Vertragsnummer ist erforderlich.");
      return orpc.contracts.create({
        memberId,
        patch: {
          vertragNr: vertragNr.trim(),
          art: selected.art,
          artName: selected.bezeichnung ?? null,
          betrag: selected.betrag1 ?? null,
          vertragBegin: vertragBegin || null,
        },
      });
    },
    onSuccess: () => onCreated(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Anlage fehlgeschlagen."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Beitragsart
          </Label>
          {feeTypes.isLoading ? (
            <div className="flex h-10 items-center px-1 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-3.5 animate-spin" /> Lade Beitragsarten…
            </div>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine verfügbaren Beitragsarten. Erst unter Einstellungen → Beitragsarten anlegen.
            </p>
          ) : (
            <select
              value={art}
              onChange={(e) => setArt(e.target.value)}
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">Bitte wählen…</option>
              {options.map((f) => (
                <option key={f.art} value={f.art}>
                  {f.bezeichnung ?? `Art ${f.art}`}
                  {f.betrag1 ? ` — ${formatCurrency(f.betrag1)}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Vertragsnummer
          </Label>
          <Input
            value={vertragNr}
            onChange={(e) => setVertragNr(e.target.value)}
            placeholder="z. B. 2026-001"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Beginn</Label>
          <Input
            type="date"
            value={vertragBegin}
            onChange={(e) => setVertragBegin(e.target.value)}
          />
        </div>
      </div>

      {selected ? (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-border/60 bg-background p-3 text-xs text-muted-foreground">
          <div>
            <div className="uppercase tracking-wide">Bezeichnung</div>
            <div className="text-sm text-foreground">{selected.bezeichnung ?? "—"}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide">Betrag</div>
            <div className="text-sm text-foreground tabular-nums">
              {formatCurrency(selected.betrag1) || "—"}
            </div>
          </div>
        </div>
      ) : null}

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
          disabled={!selected || !vertragNr.trim() || create.isPending}
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Anlegen
        </Button>
      </div>
    </div>
  );
}
