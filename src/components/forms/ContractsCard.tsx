import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { formatCurrency, formatDate, toDateInput } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Contract = {
  id: string;
  vertragNr: string;
  art: number;
  artName: string | null;
  betrag: string | null;
  aufnahmegeb?: string | null;
  sollstellung?: string | null;
  vertragBegin: string | Date | null;
  vertragEnde: string | Date | null;
  gekuendAm: string | Date | null;
  gekuendZum?: string | Date | null;
  isDirectDebit?: boolean;
  zahlerMemberId?: string | null;
  zahlerName?: string | null;
  zahlerRef?: string | null;
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
  const [editTarget, setEditTarget] = useState<Contract | null>(null);
  const [zahlerTarget, setZahlerTarget] = useState<Contract | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });

  // Track which specific row is being deleted so the spinner / disabled
  // state only applies to that one row, not every Trash icon in the table.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Contract | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => orpc.contracts.remove({ id }),
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

        {editTarget && canEdit ? (
          <EditContractForm
            contract={editTarget}
            onCancel={() => setEditTarget(null)}
            onSaved={async () => {
              setEditTarget(null);
              await refresh();
            }}
          />
        ) : null}

        {zahlerTarget && canEdit ? (
          <SetZahlerForm
            contract={zahlerTarget}
            memberId={memberId}
            onCancel={() => setZahlerTarget(null)}
            onSaved={async () => {
              setZahlerTarget(null);
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
                {canEdit ? <th className="py-1 w-28" /> : null}
              </tr>
            </thead>
            <tbody>
              {vertraege.map((v) => {
                const isDeleting = pendingDeleteId === v.id;
                return (
                  <tr key={v.id} className="border-t">
                    <td className="py-1 pr-3 tabular-nums align-top">{v.vertragNr}</td>
                    <td className="py-1 pr-3 align-top">
                      <div>{v.artName ?? v.art}</div>
                      {v.zahlerName ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Zahler: {v.zahlerName}
                          {v.zahlerRef ? ` (${v.zahlerRef})` : ""}
                        </div>
                      ) : null}
                      <div className="mt-1">
                        <ZahlartControl contract={v} canEdit={canEdit} onChanged={refresh} />
                      </div>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {formatCurrency(v.betrag)}
                    </td>
                    <td className="py-1 px-3 text-muted-foreground tabular-nums">
                      {formatDate(v.vertragBegin)}
                    </td>
                    <td className="py-1 px-3 text-muted-foreground tabular-nums">
                      {formatDate(v.vertragEnde) || (v.gekuendAm ? formatDate(v.gekuendAm) : "")}
                    </td>
                    {canEdit ? (
                      <td className="py-1 text-right whitespace-nowrap align-top">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setZahlerTarget(v)}
                          disabled={isDeleting}
                          aria-label="Zahler festlegen"
                          title="Zahler festlegen"
                        >
                          <Wallet className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditTarget(v)}
                          disabled={isDeleting}
                          aria-label="Vertrag bearbeiten"
                          title="Vertrag bearbeiten"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmTarget(v)}
                          disabled={isDeleting}
                          aria-label="Vertrag löschen"
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
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setConfirmTarget(null);
        }}
        aria-label="Vertrag löschen"
        title="Vertrag löschen"
        description={
          confirmTarget
            ? `Vertrag ${confirmTarget.vertragNr} (${confirmTarget.artName ?? confirmTarget.art}) wirklich löschen?`
            : ""
        }
        confirmLabel="Löschen"
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
  const artId = useId();
  const vertragNrId = useId();
  const beginId = useId();

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
          <Label htmlFor={artId} className="text-xs uppercase tracking-wide text-muted-foreground">
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
              id={artId}
              value={art}
              onChange={(e) => setArt(e.target.value)}
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">Bitte wählen…</option>
              {options.map((f) => (
                <option key={f.art} value={f.art}>
                  {f.bezeichnung ?? `Art ${f.art}`}
                  {f.betrag1 ? ` (${formatCurrency(f.betrag1)})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={vertragNrId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Vertragsnummer
          </Label>
          <Input
            id={vertragNrId}
            value={vertragNr}
            onChange={(e) => setVertragNr(e.target.value)}
            placeholder="z. B. 2026-001"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={beginId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Beginn
          </Label>
          <DateField id={beginId} value={vertragBegin} onChange={(v) => setVertragBegin(v)} />
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

/**
 * Zahlart eines Vertrags: Lastschrift (Standard) oder Rechnung. Klick schaltet
 * um (setzt contracts.is_direct_debit). Rechnungszahler bekommen im
 * Beitragslauf eine offene Sollstellung statt einer Lastschrift.
 */
function ZahlartControl({
  contract,
  canEdit,
  onChanged,
}: {
  contract: Contract;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  // Default ist Lastschrift (so hat Linear den Normalfall gespeichert).
  const istLastschrift = contract.isDirectDebit !== false;
  const toggle = useMutation({
    mutationFn: () => orpc.contracts.quickFix({ id: contract.id, isDirectDebit: !istLastschrift }),
    onSuccess: async () => {
      toast.success(istLastschrift ? "Auf Rechnung umgestellt" : "Auf Lastschrift umgestellt");
      await onChanged();
    },
    onError: (e: Error) => toast.error("Umstellen fehlgeschlagen", { description: e.message }),
  });

  const label = istLastschrift ? "Lastschrift" : "Rechnung";
  const pill = cn(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
    istLastschrift
      ? "bg-muted text-muted-foreground"
      : "bg-warning/15 text-warning dark:text-amber-400",
  );

  if (!canEdit) {
    return <span className={pill}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      title={`Zahlart umschalten (aktuell ${label})`}
      className={cn(pill, "transition-colors hover:ring-1 hover:ring-ring/40 disabled:opacity-60")}
    >
      {toggle.isPending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
      {label}
    </button>
  );
}

function SetZahlerForm({
  contract,
  memberId,
  onCancel,
  onSaved,
}: {
  contract: Contract;
  memberId: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  // Expliziter Zahler-Override pro Vertrag (Zahler-Konzept Stufe 2). Ohne
  // Override greift die automatische Auflösung (Familie -> Vertreter -> selbst).
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<
    Array<{
      id: string;
      vorname: string | null;
      nachname: string | null;
      memberNo: string | null;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: (query: string) =>
      orpc.relationships.searchTargets({ q: query, excludeMemberId: memberId }),
    onSuccess: (data) => setHits(data),
  });

  const setZahler = useMutation({
    mutationFn: (zahlerMemberId: string | null) =>
      orpc.contracts.setZahler({ contractId: contract.id, zahlerMemberId }),
    onSuccess: () => onSaved(),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Zahler konnte nicht gesetzt werden."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Zahler festlegen · {contract.artName ?? `Art ${contract.art}`}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background p-2.5 text-sm">
        <div>
          <span className="text-muted-foreground">Aktueller Zahler: </span>
          {contract.zahlerName ? (
            <span>
              {contract.zahlerName}
              {contract.zahlerRef ? (
                <span className="ml-1 text-xs text-muted-foreground">({contract.zahlerRef})</span>
              ) : null}
            </span>
          ) : (
            <span>Selbstzahler (automatisch)</span>
          )}
        </div>
        {contract.zahlerMemberId ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setError(null);
              setZahler.mutate(null);
            }}
            disabled={setZahler.isPending}
          >
            <X className="size-4" /> Entfernen
          </Button>
        ) : null}
      </div>

      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (e.target.value.trim().length >= 2) search.mutate(e.target.value.trim());
          else setHits([]);
        }}
        placeholder="Zahler suchen (Name oder Mitgliedsnummer)…"
        aria-label="Zahler suchen"
      />

      {hits.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate text-sm">
                {[h.nachname, h.vorname].filter(Boolean).join(", ")}
                {h.memberNo ? (
                  <span className="ml-2 text-xs text-muted-foreground">{h.memberNo}</span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setZahler.mutate(h.id);
                }}
                disabled={setZahler.isPending}
              >
                Als Zahler
              </Button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 && !search.isPending ? (
        <p className="text-xs text-muted-foreground">Keine Treffer.</p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Schließen
        </Button>
      </div>
    </div>
  );
}

function EditContractForm({
  contract,
  onCancel,
  onSaved,
}: {
  contract: Contract;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  // Beitragsart stays fixed here: it drives Bezeichnung and Betrag and is the
  // contract's identity. To change it, delete and re-create. Everything else
  // about the running contract is editable in place.
  const [vertragNr, setVertragNr] = useState(contract.vertragNr);
  const [betrag, setBetrag] = useState(contract.betrag ?? "");
  const [vertragBegin, setVertragBegin] = useState(toDateInput(contract.vertragBegin));
  const [vertragEnde, setVertragEnde] = useState(toDateInput(contract.vertragEnde));
  const [gekuendAm, setGekuendAm] = useState(toDateInput(contract.gekuendAm));
  const [gekuendZum, setGekuendZum] = useState(toDateInput(contract.gekuendZum));
  const [error, setError] = useState<string | null>(null);
  const vertragNrId = useId();
  const betragId = useId();
  const beginId = useId();
  const endeId = useId();
  const gekuendAmId = useId();
  const gekuendZumId = useId();

  const save = useMutation({
    mutationFn: () => {
      if (!vertragNr.trim()) throw new Error("Vertragsnummer ist erforderlich.");
      return orpc.contracts.update({
        id: contract.id,
        patch: {
          vertragNr: vertragNr.trim(),
          art: contract.art,
          artName: contract.artName ?? null,
          betrag: betrag.trim() || null,
          // Preserve fields not exposed in this form so the full-overwrite
          // update on the server does not null them out.
          aufnahmegeb: contract.aufnahmegeb ?? null,
          sollstellung: contract.sollstellung ?? null,
          vertragBegin: vertragBegin || null,
          vertragEnde: vertragEnde || null,
          gekuendAm: gekuendAm || null,
          gekuendZum: gekuendZum || null,
        },
      });
    },
    onSuccess: () => onSaved(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Vertrag bearbeiten · {contract.artName ?? `Art ${contract.art}`}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={vertragNrId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Vertragsnummer
          </Label>
          <Input
            id={vertragNrId}
            value={vertragNr}
            onChange={(e) => setVertragNr(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={betragId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Betrag (EUR)
          </Label>
          <Input
            id={betragId}
            inputMode="decimal"
            value={betrag}
            onChange={(e) => setBetrag(e.target.value)}
            placeholder="z. B. 60,00"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={beginId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Beginn
          </Label>
          <DateField id={beginId} value={vertragBegin} onChange={(v) => setVertragBegin(v)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={endeId} className="text-xs uppercase tracking-wide text-muted-foreground">
            Ende
          </Label>
          <DateField id={endeId} value={vertragEnde} onChange={(v) => setVertragEnde(v)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={gekuendAmId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Gekündigt am
          </Label>
          <DateField id={gekuendAmId} value={gekuendAm} onChange={(v) => setGekuendAm(v)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={gekuendZumId}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Gekündigt zum
          </Label>
          <DateField id={gekuendZumId} value={gekuendZum} onChange={(v) => setGekuendZum(v)} />
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
          disabled={!vertragNr.trim() || save.isPending}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  );
}
