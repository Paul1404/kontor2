import { useMutation, useQueryClient } from "@tanstack/react-query";
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

  const remove = useMutation({
    mutationFn: (id: string) => orpc.contracts.remove({ id }),
    onSuccess: refresh,
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
                <th className="py-1">Vertrag</th>
                <th className="py-1">Art</th>
                <th className="py-1 text-right">Betrag</th>
                <th className="py-1">Beginn</th>
                {canEdit ? <th className="py-1 w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {vertraege.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="py-1 tabular-nums">{v.vertragNr}</td>
                  <td className="py-1">{v.artName ?? v.art}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(v.betrag)}</td>
                  <td className="py-1 text-muted-foreground">{formatDate(v.vertragBegin)}</td>
                  {canEdit ? (
                    <td className="py-1 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(v.id)}
                        disabled={remove.isPending}
                        title="Vertrag löschen"
                      >
                        {remove.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4 text-destructive" />
                        )}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function AddContractForm({
  memberId,
  onCancel,
  onCreated,
}: {
  memberId: string;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [vertragNr, setVertragNr] = useState("");
  const [art, setArt] = useState("1");
  const [artName, setArtName] = useState("");
  const [betrag, setBetrag] = useState("");
  const [vertragBegin, setVertragBegin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const artInt = Number.parseInt(art, 10);
      if (!Number.isFinite(artInt)) {
        throw new Error("Art muss eine Zahl sein.");
      }
      return orpc.contracts.create({
        memberId,
        patch: {
          vertragNr: vertragNr.trim(),
          art: artInt,
          artName: artName.trim() || null,
          betrag: betrag.trim() || null,
          vertragBegin: vertragBegin || null,
        },
      });
    },
    onSuccess: () => onCreated(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Anlage fehlgeschlagen."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Vertragsnummer
          </Label>
          <Input value={vertragNr} onChange={(e) => setVertragNr(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Art (Nummer)
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            value={art}
            onChange={(e) => setArt(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Art-Bezeichnung
          </Label>
          <Input value={artName} onChange={(e) => setArtName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Betrag (EUR)
          </Label>
          <Input
            inputMode="decimal"
            value={betrag}
            onChange={(e) => setBetrag(e.target.value.replace(",", "."))}
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
          disabled={create.isPending || !vertragNr.trim()}
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
