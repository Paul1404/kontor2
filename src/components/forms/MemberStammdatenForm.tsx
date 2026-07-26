import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { LAND_OPTIONS } from "~/lib/country";
import { toDateInput } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export type StammdatenValues = {
  anrede: string;
  titel1: string;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  geschlecht: "m" | "w" | "d" | "unbekannt" | "";
  strasse: string;
  hausnummer: string;
  adresszusatz: string;
  plz: string;
  ort: string;
  land: string;
  firma1: string;
  telefon1: string;
  telefon2: string;
  email: string;
  www: string;
  funktion: string;
  spender: string;
  eintritt: string;
  austritt: string;
  iban1: string;
  abwKontoInh: string;
  vertreterAnrede: string;
  vertreterName: string;
  vertreterStrasse: string;
  vertreterHausnummer: string;
  vertreterPlz: string;
  vertreterOrt: string;
  notes: string;
  directDebitBlocked: boolean;
  ruhend: boolean;
  beitragsbefreit: boolean;
};

export const EMPTY_STAMM: StammdatenValues = {
  anrede: "",
  titel1: "",
  vorname: "",
  nachname: "",
  geburtsdatum: "",
  geschlecht: "",
  strasse: "",
  hausnummer: "",
  adresszusatz: "",
  plz: "",
  ort: "",
  land: "1",
  firma1: "",
  telefon1: "",
  telefon2: "",
  email: "",
  www: "",
  funktion: "",
  spender: "",
  eintritt: "",
  austritt: "",
  iban1: "",
  abwKontoInh: "",
  vertreterAnrede: "",
  vertreterName: "",
  vertreterStrasse: "",
  vertreterHausnummer: "",
  vertreterPlz: "",
  vertreterOrt: "",
  notes: "",
  directDebitBlocked: false,
  ruhend: false,
  beitragsbefreit: false,
};

function calcAge(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const birthYear = Number(m[1]);
  const birthMonth = Number(m[2]);
  const birthDay = Number(m[3]);
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  const beforeBirthday =
    now.getMonth() + 1 < birthMonth ||
    (now.getMonth() + 1 === birthMonth && now.getDate() < birthDay);
  if (beforeBirthday) age -= 1;
  return `${age} Jahre`;
}

export function buildInitialValues(
  member: Partial<Record<keyof StammdatenValues | "iban1Plain", unknown>> | null,
): StammdatenValues {
  if (!member) return EMPTY_STAMM;
  const geschlechtRaw = member.geschlecht as string | null | undefined;
  const geschlecht: StammdatenValues["geschlecht"] =
    geschlechtRaw === "m" ||
    geschlechtRaw === "w" ||
    geschlechtRaw === "d" ||
    geschlechtRaw === "unbekannt"
      ? geschlechtRaw
      : "";
  return {
    anrede: (member.anrede as string) ?? "",
    titel1: (member.titel1 as string) ?? "",
    vorname: (member.vorname as string) ?? "",
    nachname: (member.nachname as string) ?? "",
    geburtsdatum: toDateInput(member.geburtsdatum as string | Date | null),
    geschlecht,
    strasse: (member.strasse as string) ?? "",
    hausnummer: (member.hausnummer as string) ?? "",
    adresszusatz: (member.adresszusatz as string) ?? "",
    plz: (member.plz as string) ?? "",
    ort: (member.ort as string) ?? "",
    land: (member.land as string) ?? "1",
    firma1: (member.firma1 as string) ?? "",
    telefon1: (member.telefon1 as string) ?? "",
    telefon2: (member.telefon2 as string) ?? "",
    email: (member.email as string) ?? "",
    www: (member.www as string) ?? "",
    funktion: (member.funktion as string) ?? "",
    spender: (member.spender as string) ?? "",
    eintritt: toDateInput(member.eintritt as string | Date | null),
    austritt: toDateInput(member.austritt as string | Date | null),
    iban1: ((member.iban1 as string | null | undefined) ?? "").replace(/\s+/g, "").toUpperCase(),
    abwKontoInh: (member.abwKontoInh as string) ?? "",
    vertreterAnrede: (member.vertreterAnrede as string) ?? "",
    vertreterName: (member.vertreterName as string) ?? "",
    vertreterStrasse: (member.vertreterStrasse as string) ?? "",
    vertreterHausnummer: (member.vertreterHausnummer as string) ?? "",
    vertreterPlz: (member.vertreterPlz as string) ?? "",
    vertreterOrt: (member.vertreterOrt as string) ?? "",
    notes: (member.notes as string) ?? "",
    directDebitBlocked: (member.directDebitBlocked as boolean | null | undefined) ?? false,
    ruhend: (member.ruhend as boolean | null | undefined) ?? false,
    beitragsbefreit: (member.beitragsbefreit as boolean | null | undefined) ?? false,
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
): Record<string, string | null | boolean> {
  const out: Record<string, string | null | boolean> = {};
  const nullable = (s: string) => (s.trim().length > 0 ? s.trim() : null);
  out.anrede = nullable(values.anrede);
  out.titel1 = nullable(values.titel1);
  out.vorname = nullable(values.vorname);
  out.nachname = nullable(values.nachname);
  out.geburtsdatum = nullable(values.geburtsdatum);
  out.strasse = nullable(values.strasse);
  out.hausnummer = nullable(values.hausnummer);
  out.adresszusatz = nullable(values.adresszusatz);
  out.plz = nullable(values.plz);
  out.ort = nullable(values.ort);
  out.land = nullable(values.land);
  out.firma1 = nullable(values.firma1);
  out.telefon1 = nullable(values.telefon1);
  out.telefon2 = nullable(values.telefon2);
  out.email = nullable(values.email);
  out.www = nullable(values.www);
  out.funktion = nullable(values.funktion);
  out.spender = nullable(values.spender);
  out.eintritt = nullable(values.eintritt);
  out.austritt = nullable(values.austritt);
  if (values.geschlecht) {
    out.geschlecht = values.geschlecht;
  }
  out.abwKontoInh = nullable(values.abwKontoInh);
  out.vertreterAnrede = nullable(values.vertreterAnrede);
  out.vertreterName = nullable(values.vertreterName);
  out.vertreterStrasse = nullable(values.vertreterStrasse);
  out.vertreterHausnummer = nullable(values.vertreterHausnummer);
  out.vertreterPlz = nullable(values.vertreterPlz);
  out.vertreterOrt = nullable(values.vertreterOrt);
  out.notes = nullable(values.notes);
  out.directDebitBlocked = values.directDebitBlocked;
  out.ruhend = values.ruhend;
  out.beitragsbefreit = values.beitragsbefreit;
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
  /**
   * "kontakt" blendet die rein mitgliedschaftlichen Felder aus (Funktion,
   * Spender, Eintritt, Austritt, Beitragsstatus). Ein Kontakt ist kein
   * Mitglied, sondern z. B. ein Zahler: Name, Anschrift und Bankverbindung
   * reichen.
   */
  variant?: "member" | "kontakt";
  /**
   * Optional Stammdaten field to scroll to and focus on mount (e.g. opened from
   * a Datenqualitäts-Befund). Matches the `id="mf-<field>"` on the inputs;
   * unknown values are ignored, so the form always opens normally.
   */
  focusField?: string | null;
  /** Reports whether the locally edited values differ from the seeded record. */
  onDirtyChange?: (dirty: boolean) => void;
};

export function MemberStammdatenForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  errorMessage,
  submitLabel = "Speichern",
  mitglnrInput,
  variant = "member",
  focusField,
  onDirtyChange,
}: Props) {
  const isMember = variant === "member";

  // Deep-link from a Datenqualitäts-Befund: scroll to and focus the field that
  // needs attention. Best-effort; an unknown field just opens the form normally.
  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(`mf-${focusField}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    (el as HTMLElement).focus({ preventScroll: true });
  }, [focusField]);
  // Seed once from `initial`. The form deliberately does NOT re-sync to later
  // `initial` changes: the parent re-renders while the user types (e.g. the
  // IBAN lookup query below resolving, or a background members.get refetch),
  // and re-seeding would silently discard unsaved edits. Callers that need a
  // fresh form for a different record pass a `key` so React remounts it.
  const [values, setValues] = useState<StammdatenValues>(initial);
  const dirty = useMemo(
    () =>
      (Object.keys(initial) as Array<keyof StammdatenValues>).some(
        (key) => values[key] !== initial[key],
      ),
    [initial, values],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function update<K extends keyof StammdatenValues>(key: K, value: StammdatenValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void onSubmit(values);
  }

  const cleanedIban = useMemo(() => values.iban1.replace(/\s+/g, "").toUpperCase(), [values.iban1]);
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
          <CardContent className="grid grid-cols-1 gap-x-4 gap-y-4 text-sm sm:grid-cols-2">
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
                id="mf-nachname"
                value={values.nachname}
                onChange={(e) => update("nachname", e.target.value)}
                required
              />
            </FormField>
            <FormField
              label={`Geburtsdatum${values.geburtsdatum ? ` · ${calcAge(values.geburtsdatum)}` : ""}`}
            >
              <DateField
                id="mf-geburtsdatum"
                value={values.geburtsdatum}
                onChange={(v) => update("geburtsdatum", v)}
              />
            </FormField>
            <FormField label="Geschlecht">
              <select
                id="mf-geschlecht"
                value={values.geschlecht}
                onChange={(e) =>
                  update("geschlecht", e.target.value as StammdatenValues["geschlecht"])
                }
                className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">Bitte wählen…</option>
                <option value="m">Männlich</option>
                <option value="w">Weiblich</option>
                <option value="d">Divers</option>
                <option value="unbekannt">Unbekannt</option>
              </select>
            </FormField>
            <FormField label="Firma">
              <Input value={values.firma1} onChange={(e) => update("firma1", e.target.value)} />
            </FormField>
            <FormField label="Straße">
              <Input
                id="mf-strasse"
                value={values.strasse}
                onChange={(e) => update("strasse", e.target.value)}
              />
            </FormField>
            <FormField label="Hausnummer">
              <Input
                id="mf-hausnummer"
                value={values.hausnummer}
                onChange={(e) => update("hausnummer", e.target.value)}
              />
            </FormField>
            <FormField label="Adresszusatz" full>
              <Input
                value={values.adresszusatz}
                onChange={(e) => update("adresszusatz", e.target.value)}
                placeholder="z. B. c/o, Hinterhaus, 2. OG"
              />
            </FormField>
            <FormField label="PLZ">
              <Input
                id="mf-plz"
                value={values.plz}
                onChange={(e) => update("plz", e.target.value)}
              />
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
            <FormField label="Telefon">
              <Input
                id="mf-telefon1"
                value={values.telefon1}
                onChange={(e) => update("telefon1", e.target.value)}
              />
            </FormField>
            <FormField label="Mobil">
              <Input value={values.telefon2} onChange={(e) => update("telefon2", e.target.value)} />
            </FormField>
            <FormField label="E-Mail">
              <Input
                id="mf-email"
                type="email"
                value={values.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </FormField>
            <FormField label="Website">
              <Input
                value={values.www}
                onChange={(e) => update("www", e.target.value)}
                placeholder="https://"
              />
            </FormField>
            {isMember ? (
              <>
                <FormField label="Funktion">
                  <Input
                    value={values.funktion}
                    onChange={(e) => update("funktion", e.target.value)}
                    placeholder="z. B. Vorstand, Jugendwart"
                  />
                </FormField>
                <FormField label="Spender">
                  <select
                    value={values.spender}
                    onChange={(e) => update("spender", e.target.value)}
                    className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="">Nein</option>
                    <option value="J">Ja</option>
                  </select>
                </FormField>
                <FormField label="Eintritt">
                  <DateField value={values.eintritt} onChange={(v) => update("eintritt", v)} />
                </FormField>
                <FormField label="Austritt">
                  <DateField
                    id="mf-austritt"
                    value={values.austritt}
                    onChange={(v) => update("austritt", v)}
                  />
                </FormField>
                <FormField label="Beitrag">
                  <select
                    value={values.beitragsbefreit ? "befreit" : values.ruhend ? "ruhend" : "normal"}
                    onChange={(e) => {
                      const val = e.target.value;
                      update("ruhend", val === "ruhend");
                      update("beitragsbefreit", val === "befreit");
                    }}
                    className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="normal">Beitragspflichtig</option>
                    <option value="ruhend">Ruhend</option>
                    <option value="befreit">Beitragsbefreit</option>
                  </select>
                </FormField>
                {values.ruhend || values.beitragsbefreit ? (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Der Beitragslauf überspringt dieses Mitglied
                    {values.beitragsbefreit ? " (beitragsbefreit)" : " (ruhend)"}. Die
                    Mitgliedschaft bleibt bestehen und zählt weiterhin im Bestand.
                  </p>
                ) : null}
              </>
            ) : null}
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
                id="mf-iban1"
                value={values.iban1}
                onChange={(e) => update("iban1", e.target.value)}
                placeholder="DE…"
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
            <FormField label="SEPA-Lastschrift">
              <select
                value={values.directDebitBlocked ? "blocked" : "active"}
                onChange={(e) => update("directDebitBlocked", e.target.value === "blocked")}
                className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="active">Einzug aktiv</option>
                <option value="blocked">Einzug ausgesetzt</option>
              </select>
            </FormField>
            {values.directDebitBlocked ? (
              <p className="text-xs text-muted-foreground">
                Der Beitragslauf überspringt dieses Mitglied, bis der Einzug wieder aktiv ist.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Gesetzliche Vertretung</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-4 gap-y-4 text-sm sm:grid-cols-2">
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Empfänger für Mahnungen, wenn das Mitglied minderjährig ist. Eine als Vertretung
              markierte Beziehung hat Vorrang. Diese Felder greifen nur, wenn keine Beziehung
              markiert ist.
            </p>
            <FormField label="Anrede">
              <Input
                value={values.vertreterAnrede}
                onChange={(e) => update("vertreterAnrede", e.target.value)}
                placeholder="Herr / Frau"
              />
            </FormField>
            <FormField label="Name">
              <Input
                id="mf-vertreterName"
                value={values.vertreterName}
                onChange={(e) => update("vertreterName", e.target.value)}
                placeholder="Vor- und Nachname"
              />
            </FormField>
            <FormField label="Straße">
              <Input
                value={values.vertreterStrasse}
                onChange={(e) => update("vertreterStrasse", e.target.value)}
                placeholder="leer = Adresse des Mitglieds"
              />
            </FormField>
            <FormField label="Hausnummer">
              <Input
                value={values.vertreterHausnummer}
                onChange={(e) => update("vertreterHausnummer", e.target.value)}
              />
            </FormField>
            <FormField label="PLZ">
              <Input
                value={values.vertreterPlz}
                onChange={(e) => update("vertreterPlz", e.target.value)}
              />
            </FormField>
            <FormField label="Ort">
              <Input
                value={values.vertreterOrt}
                onChange={(e) => update("vertreterOrt", e.target.value)}
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

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
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
    // biome-ignore lint/a11y/noLabelWithoutControl: the field control is passed in as `children`, so the label wraps it and is implicitly associated.
    <label className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
