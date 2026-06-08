import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Pencil, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatDate, toDateInput } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Mandate = {
  id: string;
  mandatsNr: string;
  status: string | null;
  typ: string | null;
  lastschriftart: string | null;
  unterschriftDatum?: string | Date | null;
  gueltigAb: string | Date | null;
  gultigBis?: string | Date | null;
  widerrufenAm: string | Date | null;
  letzteVerwendung?: string | Date | null;
  isDeleted: boolean | null;
};

export function SepaCard({
  memberId,
  mitgliedsnummer,
  mandate,
  canEdit,
}: {
  memberId: string;
  mitgliedsnummer: string;
  mandate: Mandate[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editTarget, setEditTarget] = useState<Mandate | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });

  // Per-row pending state so revoking one mandate doesn't spin the icon
  // on every other row in the list.
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => orpc.sepa.revoke({ id }),
    onSuccess: async () => {
      setPendingRevokeId(null);
      await refresh();
    },
    onError: () => setPendingRevokeId(null),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>SEPA-Mandate</CardTitle>
        {canEdit && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Hinzufügen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding && canEdit ? (
          <AddMandateForm
            memberId={memberId}
            onCancel={() => setAdding(false)}
            onCreated={async () => {
              setAdding(false);
              await refresh();
            }}
          />
        ) : null}

        {editTarget && canEdit ? (
          <EditMandateForm
            mandate={editTarget}
            onCancel={() => setEditTarget(null)}
            onSaved={async () => {
              setEditTarget(null);
              await refresh();
            }}
          />
        ) : null}

        {mandate.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Mandate.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {mandate.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <div className="flex flex-col">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Mandatsreferenz
                  </span>
                  <span className="tabular-nums font-medium">{s.mandatsNr}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.lastschriftart ?? ""} {s.typ ? `· ${s.typ}` : ""}
                  </span>
                  {s.letzteVerwendung ? (
                    <span className="text-xs text-muted-foreground">
                      Letzte Verwendung {formatDate(s.letzteVerwendung)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.widerrufenAm || s.isDeleted ? "warning" : "outline"}>
                    {s.widerrufenAm || s.isDeleted ? "Widerrufen" : (s.status ?? "?")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    gültig ab {formatDate(s.gueltigAb)}
                  </span>
                  {canEdit && !s.widerrufenAm && !s.isDeleted ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditTarget(s)}
                        disabled={pendingRevokeId === s.id}
                        title="Mandat bearbeiten"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              `SEPA-Mandat ${s.mandatsNr} widerrufen? Es kann danach nicht mehr für Lastschriften verwendet werden.`,
                            )
                          ) {
                            setPendingRevokeId(s.id);
                            revoke.mutate(s.id);
                          }
                        }}
                        disabled={pendingRevokeId === s.id}
                        title="Mandat widerrufen"
                      >
                        {pendingRevokeId === s.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Ban className="size-4 text-destructive" />
                        )}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AddMandateForm({
  memberId,
  onCancel,
  onCreated,
}: {
  memberId: string;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [mandatsNr, setMandatsNr] = useState("");
  const [typ, setTyp] = useState("CORE");
  const [lastschriftart, setLastschriftart] = useState("Wiederkehrend");
  const [unterschriftDatum, setUnterschriftDatum] = useState("");
  const [gueltigAb, setGueltigAb] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mandatsNrId = useId();
  const typId = useId();
  const lastschriftartId = useId();
  const unterschriftId = useId();
  const gueltigAbId = useId();

  const create = useMutation({
    mutationFn: () =>
      orpc.sepa.create({
        memberId,
        mandatsNr: mandatsNr.trim() || null,
        typ: typ || null,
        lastschriftart: lastschriftart || null,
        status: "AKTIV",
        unterschriftDatum: unterschriftDatum || null,
        gueltigAb: gueltigAb || null,
      }),
    onSuccess: () => onCreated(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Anlage fehlgeschlagen."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={mandatsNrId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Mandatsnummer (leer = automatisch)
          </Label>
          <Input
            id={mandatsNrId}
            value={mandatsNr}
            onChange={(e) => setMandatsNr(e.target.value)}
            placeholder="auto"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={typId} className="text-xs uppercase tracking-wide text-muted-foreground">
            Typ
          </Label>
          <select
            id={typId}
            value={typ}
            onChange={(e) => setTyp(e.target.value)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="CORE">CORE: Privatpersonen (Standard)</option>
            <option value="B2B">B2B: Firmenkunden</option>
          </select>
          <p className="text-xs text-muted-foreground">
            CORE für Mitglieder mit Privatkonto. B2B nur, wenn das Konto auf eine Firma läuft und
            ein Firmenmandat hinterlegt ist.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={lastschriftartId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Lastschriftart
          </Label>
          <select
            id={lastschriftartId}
            value={lastschriftart}
            onChange={(e) => setLastschriftart(e.target.value)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="Wiederkehrend">Wiederkehrend</option>
            <option value="Einmalig">Einmalig</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={unterschriftId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Unterschrift
          </Label>
          <Input
            id={unterschriftId}
            type="date"
            value={unterschriftDatum}
            onChange={(e) => setUnterschriftDatum(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={gueltigAbId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Gültig ab
          </Label>
          <Input
            id={gueltigAbId}
            type="date"
            value={gueltigAb}
            onChange={(e) => setGueltigAb(e.target.value)}
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
          disabled={create.isPending}
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

function EditMandateForm({
  mandate,
  onCancel,
  onSaved,
}: {
  mandate: Mandate;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  // Mandatsreferenz is the mandate's identity and stays fixed. To use a
  // different reference, revoke this mandate and create a new one.
  const [typ, setTyp] = useState(mandate.typ ?? "CORE");
  const [lastschriftart, setLastschriftart] = useState(mandate.lastschriftart ?? "Wiederkehrend");
  const [unterschriftDatum, setUnterschriftDatum] = useState(
    toDateInput(mandate.unterschriftDatum),
  );
  const [gueltigAb, setGueltigAb] = useState(toDateInput(mandate.gueltigAb));
  const [gultigBis, setGultigBis] = useState(toDateInput(mandate.gultigBis));
  const [error, setError] = useState<string | null>(null);
  const typId = useId();
  const lastschriftartId = useId();
  const unterschriftId = useId();
  const gueltigAbId = useId();
  const gultigBisId = useId();

  const save = useMutation({
    mutationFn: () =>
      orpc.sepa.update({
        id: mandate.id,
        patch: {
          typ: typ || null,
          lastschriftart: lastschriftart || null,
          unterschriftDatum: unterschriftDatum || null,
          gueltigAb: gueltigAb || null,
          gultigBis: gultigBis || null,
        },
      }),
    onSuccess: () => onSaved(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Mandat bearbeiten · {mandate.mandatsNr}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={typId} className="text-xs uppercase tracking-wide text-muted-foreground">
            Typ
          </Label>
          <select
            id={typId}
            value={typ}
            onChange={(e) => setTyp(e.target.value)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="CORE">CORE: Privatpersonen (Standard)</option>
            <option value="B2B">B2B: Firmenkunden</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={lastschriftartId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Lastschriftart
          </Label>
          <select
            id={lastschriftartId}
            value={lastschriftart}
            onChange={(e) => setLastschriftart(e.target.value)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="Wiederkehrend">Wiederkehrend</option>
            <option value="Einmalig">Einmalig</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={unterschriftId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Unterschrift
          </Label>
          <Input
            id={unterschriftId}
            type="date"
            value={unterschriftDatum}
            onChange={(e) => setUnterschriftDatum(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={gueltigAbId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Gültig ab
          </Label>
          <Input
            id={gueltigAbId}
            type="date"
            value={gueltigAb}
            onChange={(e) => setGueltigAb(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={gultigBisId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Gültig bis
          </Label>
          <Input
            id={gultigBisId}
            type="date"
            value={gultigBis}
            onChange={(e) => setGultigBis(e.target.value)}
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
            save.mutate();
          }}
          disabled={save.isPending}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  );
}
