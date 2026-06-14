import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Coins, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { EMPTY_VALUE, formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/beitragsarten")({
  component: BeitragsartenSettingsPage,
});

type Form = {
  bezeichnung: string;
  abteilung: string;
  betrag1: string;
  sollstellung: string;
  kontoname: string;
  valuta: string;
  nichAktiv: boolean;
  minAge: string;
  maxAge: string;
  antragsRolle: string;
};

const EMPTY_FORM: Form = {
  bezeichnung: "",
  abteilung: "",
  betrag1: "",
  sollstellung: "",
  kontoname: "",
  valuta: "",
  nichAktiv: false,
  minAge: "",
  maxAge: "",
  antragsRolle: "",
};

// Which online-application case this Beitragsart serves. Empty = not used by the
// public application form (then the Beitragsstaffel applies as a fallback).
const ANTRAGS_ROLLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Nicht im Online-Antrag" },
  { value: "familie", label: "Familie" },
  { value: "kind", label: "Kind" },
  { value: "kind_eltern_mitglied", label: "Kind (Elternteil Mitglied)" },
  { value: "jugendlich", label: "Jugendlich" },
  { value: "jugendlich_eltern_mitglied", label: "Jugendlich (Elternteil Mitglied)" },
  { value: "junger_erwachsener", label: "Junger Erwachsener" },
  { value: "erwachsener", label: "Erwachsener" },
];

/** Parse an age input field to an integer 0-120, or null when empty/invalid. */
function parseAge(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number.parseInt(t, 10);
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
}

function BeitragsartenSettingsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["feeTypes.list"],
    queryFn: () => orpc.feeTypes.list(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["feeTypes.list"] });

  const [adding, setAdding] = useState(false);
  const [editingArt, setEditingArt] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  function formToPatch() {
    return {
      bezeichnung: form.bezeichnung.trim() || null,
      abteilung: form.abteilung.trim() || null,
      betrag1: form.betrag1.trim() || null,
      sollstellung: form.sollstellung.trim() || null,
      kontoname: form.kontoname.trim() || null,
      valuta: form.valuta.trim() || null,
      nichAktiv: form.nichAktiv ? "J" : null,
      minAge: parseAge(form.minAge),
      maxAge: parseAge(form.maxAge),
      antragsRolle: (form.antragsRolle || null) as
        | "familie"
        | "kind"
        | "kind_eltern_mitglied"
        | "jugendlich"
        | "jugendlich_eltern_mitglied"
        | "junger_erwachsener"
        | "erwachsener"
        | null,
    };
  }

  const create = useMutation({
    mutationFn: () => orpc.feeTypes.create({ patch: formToPatch() }),
    onSuccess: async () => {
      setAdding(false);
      setForm(EMPTY_FORM);
      setError(null);
      await refresh();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Fehler"),
  });

  const update = useMutation({
    mutationFn: ({ art }: { art: number }) => orpc.feeTypes.update({ art, patch: formToPatch() }),
    onSuccess: async () => {
      setEditingArt(null);
      setForm(EMPTY_FORM);
      setError(null);
      await refresh();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Fehler"),
  });

  const remove = useMutation({
    mutationFn: (art: number) => orpc.feeTypes.delete({ art }),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Fehler"),
  });

  function startEdit(row: NonNullable<typeof list.data>[number]) {
    setEditingArt(row.art);
    setAdding(false);
    setForm({
      bezeichnung: row.bezeichnung ?? "",
      abteilung: row.abteilung ?? "",
      betrag1: row.betrag1 ?? "",
      sollstellung: row.sollstellung ?? "",
      kontoname: row.kontoname ?? "",
      valuta: row.valuta ?? "",
      nichAktiv: row.nichAktiv === "J",
      minAge: row.minAge != null ? String(row.minAge) : "",
      maxAge: row.maxAge != null ? String(row.maxAge) : "",
      antragsRolle: row.antragsRolle ?? "",
    });
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Coins className="size-6 text-brand" /> Beitragsarten
          </h1>
          <p className="text-sm text-muted-foreground">
            Beitragsarten (Linear: <span className="font-mono">mgart</span>). Werden in Verträgen
            und Beitragsläufen referenziert.
          </p>
        </div>
        {!adding && editingArt == null ? (
          <Button
            onClick={() => {
              setAdding(true);
              setForm(EMPTY_FORM);
              setError(null);
            }}
          >
            <Plus className="size-4" /> Neue Beitragsart
          </Button>
        ) : null}
      </div>

      <InfoBox title="Was ist eine Beitragsart?" collapsible defaultOpen={false}>
        <p>
          Eine Beitragsart ist eine wiederkehrende Beitragsposition, die einem Mitglied per Vertrag
          zugeordnet wird. Beispiele: <em>Erwachsene</em>, <em>Jugend</em>, <em>Familie</em>,{" "}
          <em>Passiv</em>, <em>Tennisabteilung</em>.
        </p>
        <p className="mt-2">
          Jede Beitragsart hat einen Betrag, eine Sollstellungsregel, einen Verwendungszweck und
          optional eine Abteilung. Beim Anlegen eines Beitragslaufs greift das System auf die hier
          hinterlegten Werte zurück.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Inaktive Arten erscheinen in keiner neuen Beitragsabrechnung mehr, bestehende Verträge mit
          dieser Art bleiben aber bestehen. <span className="font-mono">mgart</span> ist der
          Schlüssel in Linear Webverein und wird beim Import erhalten.
        </p>
      </InfoBox>

      {adding || editingArt != null ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingArt != null ? `Beitragsart ${editingArt} bearbeiten` : "Neue Beitragsart"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Bezeichnung">
                <Input
                  value={form.bezeichnung}
                  onChange={(e) => setForm({ ...form, bezeichnung: e.target.value })}
                  placeholder="z. B. Einzelmitgliedschaft"
                />
              </FormField>
              <FormField label="Abteilung (Text)">
                <Input
                  value={form.abteilung}
                  onChange={(e) => setForm({ ...form, abteilung: e.target.value })}
                  placeholder="z. B. Fußball"
                />
              </FormField>
              <FormField label="Betrag (EUR)">
                <Input
                  inputMode="decimal"
                  value={form.betrag1}
                  onChange={(e) => setForm({ ...form, betrag1: e.target.value.replace(",", ".") })}
                  placeholder="0.00"
                />
              </FormField>
              <FormField label="Sollstellung">
                <Input
                  value={form.sollstellung}
                  onChange={(e) => setForm({ ...form, sollstellung: e.target.value })}
                  placeholder="J / N"
                />
              </FormField>
              <FormField label="Kontoname">
                <Input
                  value={form.kontoname}
                  onChange={(e) => setForm({ ...form, kontoname: e.target.value })}
                />
              </FormField>
              <FormField label="Valuta">
                <Input
                  value={form.valuta}
                  onChange={(e) => setForm({ ...form, valuta: e.target.value })}
                />
              </FormField>
              <FormField label="Alter von (Jahre)">
                <Input
                  inputMode="numeric"
                  value={form.minAge}
                  onChange={(e) => setForm({ ...form, minAge: e.target.value })}
                  placeholder="z. B. 18"
                />
              </FormField>
              <FormField label="Alter bis (Jahre)">
                <Input
                  inputMode="numeric"
                  value={form.maxAge}
                  onChange={(e) => setForm({ ...form, maxAge: e.target.value })}
                  placeholder="z. B. 17"
                />
              </FormField>
              <p className="-mt-1 text-xs text-muted-foreground">
                Optional. Gesetzt, prüft die Datenqualität, ob das Alter der Mitglieder zur
                Beitragsart passt. Leer lassen, wenn die Beitragsart nicht altersabhängig ist.
              </p>
              <FormField label="Rolle im Online-Antrag">
                <select
                  value={form.antragsRolle}
                  onChange={(e) => setForm({ ...form, antragsRolle: e.target.value })}
                  className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-soft"
                >
                  {ANTRAGS_ROLLE_OPTIONS.map((o) => (
                    <option key={o.value || "none"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <p className="-mt-1 text-xs text-muted-foreground">
                Optional. Gesetzt, nutzt der Online-Antrag für diesen Fall den Betrag dieser
                Beitragsart und legt sie bei der Genehmigung an. Leer: es gilt die Beitragsstaffel.
                Je Rolle ist nur eine Beitragsart möglich.
              </p>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.nichAktiv}
                  onChange={(e) => setForm({ ...form, nichAktiv: e.target.checked })}
                  className="size-4 accent-primary"
                />
                <span>Nicht aktiv</span>
              </label>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setEditingArt(null);
                  setForm(EMPTY_FORM);
                  setError(null);
                }}
              >
                Abbrechen
              </Button>
              <Button
                onClick={() => {
                  if (editingArt != null) update.mutate({ art: editingArt });
                  else create.mutate();
                }}
                disabled={create.isPending || update.isPending}
              >
                {create.isPending || update.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Speichern
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Art</th>
                <th className="px-4 py-3 font-medium">Bezeichnung</th>
                <th className="px-4 py-3 font-medium">Abteilung</th>
                <th className="px-4 py-3 text-right font-medium">Betrag</th>
                <th className="px-4 py-3 text-right font-medium">Verträge</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Wird geladen…
                    </span>
                  </td>
                </tr>
              ) : list.isError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6">
                    <QueryError onRetry={() => list.refetch()} />
                  </td>
                </tr>
              ) : !list.data || list.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Noch keine Beitragsarten.
                  </td>
                </tr>
              ) : (
                list.data.map((row) => {
                  const canDelete = row.contractCount === 0;
                  return (
                    <tr key={row.art} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{row.art}</td>
                      <td className="px-4 py-3 font-medium">{row.bezeichnung ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.abteilung || EMPTY_VALUE}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(row.betrag1)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.contractCount}</td>
                      <td className="px-4 py-3">
                        {row.nichAktiv === "J" ? (
                          <Badge variant="secondary">Inaktiv</Badge>
                        ) : (
                          <Badge variant="success">Aktiv</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(row)}
                            aria-label={`Beitragsart ${row.art} bearbeiten`}
                            title="Bearbeiten"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Beitragsart ${row.art} (${row.bezeichnung ?? ""}) löschen?`,
                                )
                              ) {
                                remove.mutate(row.art);
                              }
                            }}
                            disabled={!canDelete || remove.isPending}
                            aria-label={
                              canDelete
                                ? `Beitragsart ${row.art} löschen`
                                : "Wird von Verträgen referenziert"
                            }
                            title={canDelete ? "Löschen" : "Wird von Verträgen referenziert"}
                          >
                            <Trash2
                              className={`size-4 ${canDelete ? "text-destructive" : "text-muted-foreground"}`}
                            />
                          </Button>
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

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
