import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { LAND_OPTIONS } from "~/lib/country";
import { orpc } from "~/lib/orpc";

export type StammdatenValues = {
  anrede: string;
  titel1: string;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  land: string;
  telefon1: string;
  telefon2: string;
  eMailName: string;
  eintritt: string;
  austritt: string;
  aktivPasiv: "A" | "P" | "";
  iban1: string;
  abwKontoInh: string;
  notes: string;
};

export const EMPTY_STAMM: StammdatenValues = {
  anrede: "",
  titel1: "",
  vorname: "",
  nachname: "",
  geburtsdatum: "",
  strasse: "",
  hausnummer: "",
  plz: "",
  ort: "",
  land: "1",
  telefon1: "",
  telefon2: "",
  eMailName: "",
  eintritt: "",
  austritt: "",
  aktivPasiv: "",
  iban1: "",
  abwKontoInh: "",
  notes: "",
};

function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function buildInitialValues(
  member: Partial<Record<keyof StammdatenValues | "iban1Plain", unknown>> | null,
): StammdatenValues {
  if (!member) return EMPTY_STAMM;
  return {
    anrede: (member.anrede as string) ?? "",
    titel1: (member.titel1 as string) ?? "",
    vorname: (member.vorname as string) ?? "",
    nachname: (member.nachname as string) ?? "",
    geburtsdatum: toDateInput(member.geburtsdatum as string | Date | null),
    strasse: (member.strasse as string) ?? "",
    hausnummer: (member.hausnummer as string) ?? "",
    plz: (member.plz as string) ?? "",
    ort: (member.ort as string) ?? "",
    land: (member.land as string) ?? "1",
    telefon1: (member.telefon1 as string) ?? "",
    telefon2: (member.telefon2 as string) ?? "",
    eMailName: ((member as Record<string, unknown>).eMailName as string) ?? "",
    eintritt: toDateInput(member.eintritt as string | Date | null),
    austritt: toDateInput(member.austritt as string | Date | null),
    aktivPasiv: (member.aktivPasiv === "A" ? "A" : member.aktivPasiv === "P" ? "P" : "") as
      | "A"
      | "P"
      | "",
    iban1: ((member.iban1 as string | null | undefined) ?? "")
      .replace(/\s+/g, "")
      .toUpperCase(),
    abwKontoInh: (member.abwKontoInh as string) ?? "",
    notes: (member.notes as string) ?? "",
  };
}

/**
 * Reduce the form state into the exact patch sent to the server. Empty
 * strings become `null`; the IBAN is only included when the user actually
 * typed something (so existing ciphertext is not overwritten with a blank).
 */
export function buildPatch(
  values: StammdatenValues,
  initialIban: string,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const nullable = (s: string) => (s.trim().length > 0 ? s.trim() : null);
  out.anrede = nullable(values.anrede);
  out.titel1 = nullable(values.titel1);
  out.vorname = nullable(values.vorname);
  out.nachname = nullable(values.nachname);
  out.geburtsdatum = nullable(values.geburtsdatum);
  out.strasse = nullable(values.strasse);
  out.hausnummer = nullable(values.hausnummer);
  out.plz = nullable(values.plz);
  out.ort = nullable(values.ort);
  out.land = nullable(values.land);
  out.telefon1 = nullable(values.telefon1);
  out.telefon2 = nullable(values.telefon2);
  out.eMailName = nullable(values.eMailName);
  out.eintritt = nullable(values.eintritt);
  out.austritt = nullable(values.austritt);
  if (values.aktivPasiv === "A" || values.aktivPasiv === "P") {
    out.aktivPasiv = values.aktivPasiv;
  }
  out.abwKontoInh = nullable(values.abwKontoInh);
  out.notes = nullable(values.notes);
  const normIban = values.iban1.replace(/\s+/g, "").toUpperCase();
  if (normIban !== initialIban) {
    out.iban1 = normIban.length > 0 ? normIban : null;
  }
  return out;
}

type Props = {
  initial: StammdatenValues;
  onSubmit: (values: StammdatenValues) => void | Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
  errorMessage?: string | null;
  submitLabel?: string;
  mitglnrInput?: { value: string; onChange: (next: string) => void };
};

export function MemberStammdatenForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  errorMessage,
  submitLabel = "Speichern",
  mitglnrInput,
}: Props) {
  const [values, setValues] = useState<StammdatenValues>(initial);
  useEffect(() => {
    setValues(initial);
  }, [initial]);

  function update<K extends keyof StammdatenValues>(key: K, value: StammdatenValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void onSubmit(values);
  }

  const cleanedIban = useMemo(
    () => values.iban1.replace(/\s+/g, "").toUpperCase(),
    [values.iban1],
  );
  const ibanLookup = useQuery({
    queryKey: ["banks.lookupByIban", cleanedIban],
    queryFn: () => orpc.banks.lookupByIban({ iban: cleanedIban }),
    enabled: cleanedIban.length >= 12 && cleanedIban.startsWith("DE"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const derived = ibanLookup.data?.found ? ibanLookup.data : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stammdaten</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            {mitglnrInput ? (
              <FormField label="Mitgliedsnummer (leer = automatisch)">
                <Input
                  value={mitglnrInput.value}
                  onChange={(e) => mitglnrInput.onChange(e.target.value)}
                  placeholder="auto"
                />
              </FormField>
            ) : null}
            <FormField label="Anrede">
              <Input value={values.anrede} onChange={(e) => update("anrede", e.target.value)} />
            </FormField>
            <FormField label="Titel">
              <Input value={values.titel1} onChange={(e) => update("titel1", e.target.value)} />
            </FormField>
            <FormField label="Vorname">
              <Input
                value={values.vorname}
                onChange={(e) => update("vorname", e.target.value)}
                required
              />
            </FormField>
            <FormField label="Nachname">
              <Input
                value={values.nachname}
                onChange={(e) => update("nachname", e.target.value)}
                required
              />
            </FormField>
            <FormField label="Geburtsdatum">
              <Input
                type="date"
                value={values.geburtsdatum}
                onChange={(e) => update("geburtsdatum", e.target.value)}
              />
            </FormField>
            <FormField label="Straße">
              <Input value={values.strasse} onChange={(e) => update("strasse", e.target.value)} />
            </FormField>
            <FormField label="Hausnummer">
              <Input
                value={values.hausnummer}
                onChange={(e) => update("hausnummer", e.target.value)}
              />
            </FormField>
            <FormField label="PLZ">
              <Input value={values.plz} onChange={(e) => update("plz", e.target.value)} />
            </FormField>
            <FormField label="Ort">
              <Input value={values.ort} onChange={(e) => update("ort", e.target.value)} />
            </FormField>
            <FormField label="Land">
              <select
                value={values.land}
                onChange={(e) => update("land", e.target.value)}
                className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {LAND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Status">
              <select
                value={values.aktivPasiv}
                onChange={(e) => update("aktivPasiv", e.target.value as "A" | "P" | "")}
                className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">Unbekannt</option>
                <option value="A">Aktiv</option>
                <option value="P">Passiv</option>
              </select>
            </FormField>
            <FormField label="Telefon">
              <Input value={values.telefon1} onChange={(e) => update("telefon1", e.target.value)} />
            </FormField>
            <FormField label="Mobil">
              <Input value={values.telefon2} onChange={(e) => update("telefon2", e.target.value)} />
            </FormField>
            <FormField label="E-Mail">
              <Input
                type="email"
                value={values.eMailName}
                onChange={(e) => update("eMailName", e.target.value)}
              />
            </FormField>
            <FormField label="Eintritt">
              <Input
                type="date"
                value={values.eintritt}
                onChange={(e) => update("eintritt", e.target.value)}
              />
            </FormField>
            <FormField label="Austritt">
              <Input
                type="date"
                value={values.austritt}
                onChange={(e) => update("austritt", e.target.value)}
              />
            </FormField>
            <FormField label="Notizen" full>
              <Textarea
                value={values.notes}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
              />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bankverbindung</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <FormField label="IBAN">
              <Input
                value={values.iban1}
                onChange={(e) => update("iban1", e.target.value)}
                placeholder="DE..."
                className="font-mono"
              />
            </FormField>
            <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <div className="uppercase tracking-wide text-muted-foreground">
                Bank (automatisch)
              </div>
              <div className="text-foreground">
                {ibanLookup.isFetching && cleanedIban.length >= 12 ? (
                  <span className="text-muted-foreground">Wird ermittelt…</span>
                ) : derived ? (
                  <>
                    <div>{derived.name}</div>
                    <div className="font-mono text-muted-foreground">BIC {derived.bic}</div>
                  </>
                ) : cleanedIban.length === 0 ? (
                  <span className="text-muted-foreground">
                    Bank und BIC werden aus der IBAN ermittelt.
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Kein Treffer im Bundesbank-Verzeichnis. Bitte IBAN prüfen.
                  </span>
                )}
              </div>
            </div>
            <FormField label="Kontoinhaber (abweichend)">
              <Input
                value={values.abwKontoInh}
                onChange={(e) => update("abwKontoInh", e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          <X className="size-4" /> Abbrechen
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "col-span-2" : ""}`}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
