import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AbteilungPicker } from "~/components/antrag/abteilung-picker";
import { IbanField } from "~/components/antrag/iban-field";
import { SignaturePad } from "~/components/antrag/signature-pad";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/cn";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/antrag/")({
  component: AntragForm,
});

type Anrede = "Herr" | "Frau" | "keine Angabe";
type KindRow = { vorname: string; nachname: string; geburtsdatum: string; abteilungen: string[] };

const STEPS = ["Mitgliedsdaten", "SEPA-Lastschrift", "Zusammenfassung"];

function realAge(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - (y ?? 0);
  if (
    today.getMonth() + 1 < (m ?? 0) ||
    (today.getMonth() + 1 === m && today.getDate() < (d ?? 0))
  ) {
    age -= 1;
  }
  return age;
}

function AntragForm() {
  const settings = useQuery({
    queryKey: ["applications.publicSettings"],
    queryFn: () => orpc.applications.publicSettings(),
  });
  const abteilungen = settings.data?.abteilungen ?? [];

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ antragsnummer: string } | null>(null);

  // Step 0
  const [geschlecht, setGeschlecht] = useState<Anrede | null>(null);
  const [vorname, setVorname] = useState("");
  const [nachname, setNachname] = useState("");
  const [geburtsdatum, setGeburtsdatum] = useState("");
  const [strasse, setStrasse] = useState("");
  const [hausnummer, setHausnummer] = useState("");
  const [plz, setPlz] = useState("");
  const [ort, setOrt] = useState("");
  const [telefon, setTelefon] = useState("");
  const [email, setEmail] = useState("");
  const [selectedAbt, setSelectedAbt] = useState<string[]>([]);
  const [erzVorname, setErzVorname] = useState("");
  const [erzNachname, setErzNachname] = useState("");
  const [elternteilMitglied, setElternteilMitglied] = useState(false);
  const [partnerVorname, setPartnerVorname] = useState("");
  const [partnerNachname, setPartnerNachname] = useState("");
  const [partnerGeburtsdatum, setPartnerGeburtsdatum] = useState("");
  const [partnerAbt, setPartnerAbt] = useState<string[]>([]);
  const [kinder, setKinder] = useState<KindRow[]>([]);

  // Step 1
  const [kontoinhaber, setKontoinhaber] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [kreditinstitut, setKreditinstitut] = useState("");

  // Step 2
  const [signOnline, setSignOnline] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);
  const [datenschutz, setDatenschutz] = useState(false);
  const [satzung, setSatzung] = useState(false);

  const age = geburtsdatum ? realAge(geburtsdatum) : null;
  const isMinor = age != null && age < 18;
  const hasPartner = partnerVorname.trim().length >= 2 && partnerNachname.trim().length >= 2;
  const antragstyp: "einzel" | "kind" | "familie" = isMinor
    ? "kind"
    : kinder.length > 0 && hasPartner
      ? "familie"
      : "einzel";

  const fee = useQuery({
    queryKey: ["applications.calculateFee", geburtsdatum, antragstyp, elternteilMitglied],
    queryFn: () => orpc.applications.calculateFee({ geburtsdatum, antragstyp, elternteilMitglied }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(geburtsdatum),
  });

  // Default the account holder to the contact person when reaching SEPA.
  useEffect(() => {
    if (step === 1 && !kontoinhaber.trim()) {
      const payer = isMinor
        ? `${erzVorname} ${erzNachname}`.trim()
        : `${vorname} ${nachname}`.trim();
      if (payer) setKontoinhaber(payer);
    }
  }, [step, isMinor, erzVorname, erzNachname, vorname, nachname, kontoinhaber]);

  const submit = useMutation({
    mutationFn: () =>
      orpc.applications.submit({
        geschlecht,
        vorname,
        nachname,
        geburtsdatum,
        strasse: strasse || null,
        hausnummer: hausnummer || null,
        plz: plz || null,
        ort: ort || null,
        telefon: telefon || null,
        email: email || null,
        abteilungen: selectedAbt,
        erziehungsberechtigterVorname: isMinor ? erzVorname || null : null,
        erziehungsberechtigterNachname: isMinor ? erzNachname || null : null,
        partnerVorname: antragstyp === "familie" ? partnerVorname || null : null,
        partnerNachname: antragstyp === "familie" ? partnerNachname || null : null,
        partnerGeburtsdatum:
          antragstyp === "familie" && partnerGeburtsdatum ? partnerGeburtsdatum : null,
        partnerAbteilungen: antragstyp === "familie" ? partnerAbt : [],
        kinder: antragstyp === "familie" ? kinder : [],
        elternteilMitglied,
        kontoinhaber: kontoinhaber || null,
        iban: iban.replace(/\s/g, ""),
        bic: bic || null,
        kreditinstitut: kreditinstitut || null,
        unterschriftBase64: signOnline ? signature : null,
        datenschutzAccepted: datenschutz,
        satzungAccepted: satzung,
      }),
    onSuccess: (res) => setResult({ antragsnummer: res.antragsnummer }),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Der Antrag konnte nicht gesendet werden."),
  });

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!geschlecht && !isMinor) return "Bitte eine Anrede wählen.";
      if (vorname.trim().length < 2 || nachname.trim().length < 2)
        return "Bitte Vor- und Nachname angeben.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(geburtsdatum))
        return "Bitte ein gültiges Geburtsdatum angeben.";
      if (selectedAbt.length === 0) return "Bitte mindestens eine Abteilung wählen.";
      if (!email.trim()) return "Bitte eine E-Mail-Adresse angeben.";
      if (isMinor && (erzVorname.trim().length < 2 || erzNachname.trim().length < 2))
        return "Bitte die gesetzliche Vertretung angeben.";
    }
    if (s === 1) {
      if (iban.replace(/\s/g, "").length < 15) return "Bitte eine gültige IBAN angeben.";
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    setError(err);
    if (!err) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" /> Antrag eingegangen
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            Vielen Dank. Ihre Antragsnummer lautet{" "}
            <span className="font-semibold">{result.antragsnummer}</span>.
          </p>
          <p className="text-muted-foreground">
            {signOnline
              ? "Sie erhalten eine Bestätigung per E-Mail mit der Beitrittserklärung im Anhang."
              : "Sie erhalten die Beitrittserklärung per E-Mail. Bitte unterschreiben Sie sie und laden Sie den Scan über den Link in der E-Mail wieder hoch."}
          </p>
          <Link
            to="/antrag/status"
            search={{ nr: result.antragsnummer }}
            className="text-sm text-primary hover:underline"
          >
            Status verfolgen
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper step={step} />

      {step === 0 ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Mitgliedsdaten</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!isMinor ? (
                <div className="flex flex-wrap gap-2">
                  {(["Herr", "Frau", "keine Angabe"] as Anrede[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setGeschlecht(a)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm",
                        geschlecht === a
                          ? "border-primary bg-primary/10"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Vorname *">
                  <Input value={vorname} onChange={(e) => setVorname(e.target.value)} />
                </Field>
                <Field label="Nachname *">
                  <Input value={nachname} onChange={(e) => setNachname(e.target.value)} />
                </Field>
                <Field label="Geburtsdatum *">
                  <Input
                    type="date"
                    value={geburtsdatum}
                    onChange={(e) => setGeburtsdatum(e.target.value)}
                  />
                </Field>
                <div />
                <Field label="Straße">
                  <Input value={strasse} onChange={(e) => setStrasse(e.target.value)} />
                </Field>
                <Field label="Hausnummer">
                  <Input value={hausnummer} onChange={(e) => setHausnummer(e.target.value)} />
                </Field>
                <Field label="PLZ">
                  <Input value={plz} onChange={(e) => setPlz(e.target.value)} />
                </Field>
                <Field label="Ort">
                  <Input value={ort} onChange={(e) => setOrt(e.target.value)} />
                </Field>
                <Field label="Telefon">
                  <Input value={telefon} onChange={(e) => setTelefon(e.target.value)} />
                </Field>
                <Field label="E-Mail *">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          {isMinor ? (
            <Card>
              <CardHeader>
                <CardTitle>Gesetzliche Vertretung</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Vorname *">
                    <Input value={erzVorname} onChange={(e) => setErzVorname(e.target.value)} />
                  </Field>
                  <Field label="Nachname *">
                    <Input value={erzNachname} onChange={(e) => setErzNachname(e.target.value)} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={elternteilMitglied}
                    onChange={(e) => setElternteilMitglied(e.target.checked)}
                  />
                  Ein Elternteil ist bereits Mitglied (reduzierter Beitrag)
                </label>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Abteilungen *</CardTitle>
            </CardHeader>
            <CardContent>
              <AbteilungPicker
                abteilungen={abteilungen}
                selected={selectedAbt}
                onToggle={(id) => toggle(selectedAbt, setSelectedAbt, id)}
              />
            </CardContent>
          </Card>

          {!isMinor ? (
            <Card>
              <CardHeader>
                <CardTitle>Familie (optional)</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-xs text-muted-foreground">
                  Für die Familienmitgliedschaft tragen Sie einen Partner / ein zweites Elternteil
                  und mindestens ein Kind ein.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Partner Vorname">
                    <Input
                      value={partnerVorname}
                      onChange={(e) => setPartnerVorname(e.target.value)}
                    />
                  </Field>
                  <Field label="Partner Nachname">
                    <Input
                      value={partnerNachname}
                      onChange={(e) => setPartnerNachname(e.target.value)}
                    />
                  </Field>
                  <Field label="Partner Geburtsdatum">
                    <Input
                      type="date"
                      value={partnerGeburtsdatum}
                      onChange={(e) => setPartnerGeburtsdatum(e.target.value)}
                    />
                  </Field>
                </div>
                {hasPartner ? (
                  <div>
                    <Label className="mb-1.5 block">Abteilungen des Partners</Label>
                    <AbteilungPicker
                      abteilungen={abteilungen}
                      selected={partnerAbt}
                      onToggle={(id) => toggle(partnerAbt, setPartnerAbt, id)}
                    />
                  </div>
                ) : null}

                <div className="flex flex-col gap-3">
                  {kinder.map((k, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and short-lived.
                    <div key={`kind-${i}`} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">Kind {i + 1}</span>
                        <button
                          type="button"
                          aria-label="Kind entfernen"
                          onClick={() => setKinder((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Input
                          placeholder="Vorname"
                          value={k.vorname}
                          onChange={(e) => updateKind(setKinder, i, { vorname: e.target.value })}
                        />
                        <Input
                          placeholder="Nachname"
                          value={k.nachname}
                          onChange={(e) => updateKind(setKinder, i, { nachname: e.target.value })}
                        />
                        <Input
                          type="date"
                          value={k.geburtsdatum}
                          onChange={(e) =>
                            updateKind(setKinder, i, { geburtsdatum: e.target.value })
                          }
                        />
                      </div>
                      <div className="mt-2">
                        <AbteilungPicker
                          abteilungen={abteilungen}
                          selected={k.abteilungen}
                          onToggle={(id) =>
                            updateKind(setKinder, i, {
                              abteilungen: k.abteilungen.includes(id)
                                ? k.abteilungen.filter((x) => x !== id)
                                : [...k.abteilungen, id],
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      setKinder((prev) => [
                        ...prev,
                        {
                          vorname: "",
                          nachname: nachname.trim(),
                          geburtsdatum: "",
                          abteilungen: [],
                        },
                      ])
                    }
                  >
                    <Plus className="size-4" /> Kind hinzufügen
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>SEPA-Lastschrift</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Kontoinhaber">
              <Input value={kontoinhaber} onChange={(e) => setKontoinhaber(e.target.value)} />
            </Field>
            <div />
            <IbanField
              value={iban}
              onChange={setIban}
              onResolved={(info) => {
                if (info.bic) setBic(info.bic);
                if (info.name) setKreditinstitut(info.name);
              }}
            />
            <Field label="BIC">
              <Input value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Kreditinstitut">
              <Input value={kreditinstitut} onChange={(e) => setKreditinstitut(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Zusammenfassung</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Row label="Antragsteller">{`${vorname} ${nachname}`.trim()}</Row>
              <Row label="Mitgliedschaft">{fee.data?.label ?? "…"}</Row>
              <Row label="Jahresbeitrag">{fee.data ? `${fee.data.jahresbeitrag} EUR` : "…"}</Row>
              <Row label="Abteilungen">
                {abteilungen
                  .filter((a) => selectedAbt.includes(a.id))
                  .map((a) => a.name)
                  .join(", ") || "—"}
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unterschrift</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSignOnline(true)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm",
                    signOnline
                      ? "border-primary bg-primary/10"
                      : "border-border text-muted-foreground",
                  )}
                >
                  Jetzt unterschreiben
                </button>
                <button
                  type="button"
                  onClick={() => setSignOnline(false)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm",
                    !signOnline
                      ? "border-primary bg-primary/10"
                      : "border-border text-muted-foreground",
                  )}
                >
                  Per E-Mail erhalten und später unterschreiben
                </button>
              </div>
              {signOnline ? <SignaturePad value={signature} onChange={setSignature} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={datenschutz}
                  onChange={(e) => setDatenschutz(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Ich habe die{" "}
                  {settings.data?.datenschutzUrl ? (
                    <a
                      href={settings.data.datenschutzUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Datenschutzerklärung
                    </a>
                  ) : (
                    "Datenschutzerklärung"
                  )}{" "}
                  gelesen und akzeptiere sie.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={satzung}
                  onChange={(e) => setSatzung(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Ich erkenne die{" "}
                  {settings.data?.satzungUrl ? (
                    <a
                      href={settings.data.satzungUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Satzung
                    </a>
                  ) : (
                    "Satzung"
                  )}{" "}
                  des Vereins an.
                </span>
              </label>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          disabled={step === 0 || submit.isPending}
        >
          <ChevronLeft className="size-4" /> Zurück
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next}>
            Weiter <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            disabled={submit.isPending || !datenschutz || !satzung || (signOnline && !signature)}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
          >
            {submit.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Beitritt erklären
          </Button>
        )}
      </div>
    </div>
  );
}

function updateKind(
  set: React.Dispatch<React.SetStateAction<KindRow[]>>,
  index: number,
  patch: Partial<KindRow>,
) {
  set((prev) => prev.map((k, i) => (i === index ? { ...k, ...patch } : k)));
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3">
      {STEPS.map((label, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static step list.
        <div key={label} className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("text-sm", i === step ? "font-medium" : "text-muted-foreground")}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 ? <div className="h-px w-6 bg-border" /> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="flex flex-col gap-1.5">
      <span>{label}</span>
      {children}
    </Label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
