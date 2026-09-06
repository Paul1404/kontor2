import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  Mail,
  Pencil,
  PenLine,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AbteilungPicker } from "~/components/antrag/abteilung-picker";
import { type AddressFieldKey, AddressFields } from "~/components/antrag/address-fields";
import { Field, FieldHelper, fieldStateOf, HelpTip, Reveal } from "~/components/antrag/field";
import { IbanField } from "~/components/antrag/iban-field";
import { SignaturePad } from "~/components/antrag/signature-pad";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  realAgeFromIso,
  validateBicMessage,
  validateIbanMessage,
  validateNameMessage,
  validatePastDateMessage,
  validatePhoneMessage,
  validatePlzMessage,
} from "~/lib/application-validation";
import { cn } from "~/lib/cn";
import { EMPTY_VALUE, formatCurrency, formatDate, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";
import { normalizeTenantPolicy } from "~/lib/tenant-settings";

type Anrede = "Herr" | "Frau" | "keine Angabe";
type KindRow = { vorname: string; nachname: string; geburtsdatum: string; abteilungen: string[] };

const STEPS = ["Mitgliedsdaten", "SEPA-Lastschrift", "Zusammenfassung"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Order in which invalid fields are surfaced (drives scroll-to-first-error).
const ERROR_ORDER = [
  "geschlecht",
  "vorname",
  "nachname",
  "geburtsdatum",
  "abteilung",
  "strasse",
  "plz",
  "ort",
  "telefon",
  "email",
  "erzVorname",
  "erzNachname",
  "elternteilMitglied",
  "partnerVorname",
  "partnerNachname",
  "partnerGeburtsdatum",
  "iban",
  "bic",
] as const;

// Subtle magnetic pull of an element toward the pointer. Offsets are written to
// CSS custom properties consumed by `.btn-magnetic`; reduced-motion neutralizes
// the transform in CSS, so the written values simply have no visible effect.
function useMagnetic() {
  const ref = useRef<HTMLButtonElement>(null);
  function onPointerMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${(e.clientX - (r.left + r.width / 2)) * 0.18}px`);
    el.style.setProperty("--my", `${(e.clientY - (r.top + r.height / 2)) * 0.3}px`);
  }
  function onPointerLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--mx", "0px");
    el.style.setProperty("--my", "0px");
  }
  return { ref, onPointerMove, onPointerLeave };
}

// Draft persistence: keep an in-progress application across reloads. Uses
// sessionStorage (cleared when the tab closes), matching svums and keeping the
// applicant's data off the device long-term. The signature is intentionally
// excluded; it is re-drawn on the summary step.
const DRAFT_KEY = "kontor2-antrag-draft-v1";

type Draft = {
  step: number;
  geschlecht: Anrede | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  telefon: string;
  telefonOptOut: boolean;
  email: string;
  selectedAbt: string[];
  passive: boolean;
  erzVorname: string;
  erzNachname: string;
  elternteilMitglied: boolean;
  partnerVorname: string;
  partnerNachname: string;
  partnerGeburtsdatum: string;
  partnerAbt: string[];
  kinder: KindRow[];
  kontoinhaber: string;
  iban: string;
  bic: string;
  kreditinstitut: string;
  signOnline: boolean;
  datenschutz: boolean;
  satzung: boolean;
};

function AntragForm() {
  const settings = useQuery({
    queryKey: ["applications.publicSettings"],
    queryFn: () => orpc.applications.publicSettings(),
  });
  const abteilungen = settings.data?.abteilungen ?? [];
  const vereinsname = settings.data?.vereinsname ?? "der Verein";
  const tenantPolicy = normalizeTenantPolicy(settings.data?.tenantPolicy);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"forward" | "backward">("forward");
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
  const [telefonOptOut, setTelefonOptOut] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedAbt, setSelectedAbt] = useState<string[]>([]);
  const [passive, setPassive] = useState(false);
  const [erzVorname, setErzVorname] = useState("");
  const [erzNachname, setErzNachname] = useState("");
  const [elternteilMitglied, setElternteilMitglied] = useState(false);
  const [partnerVorname, setPartnerVorname] = useState("");
  const [partnerNachname, setPartnerNachname] = useState("");
  const [partnerGeburtsdatum, setPartnerGeburtsdatum] = useState("");
  const [partnerAbt, setPartnerAbt] = useState<string[]>([]);
  const [kinder, setKinder] = useState<KindRow[]>([]);
  // The family section stays collapsed by default so the common Einzel/Kind
  // path is not cluttered by partner and children editors. It opens on demand,
  // or automatically once a restored draft already carries family data.
  const [familieOpen, setFamilieOpen] = useState(false);

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

  // Draft + duplicate-check state.
  const [hydrated, setHydrated] = useState(false);
  const [draftState, setDraftState] = useState<"idle" | "restored" | "saved">("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const [dupAck, setDupAck] = useState(false);
  // Live (debounced) duplicate hint shown while typing the identity.
  const [dupHint, setDupHint] = useState<string | null>(null);

  // Per-field validation: error messages keyed by field, plus a nonce that
  // re-triggers the attention pulse on every failed step.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pulseNonce, setPulseNonce] = useState(0);
  function clearError(key: string) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  // Blur validation for a filled field: a value that does not make sense is
  // flagged right away, an empty field waits for the step check so tabbing
  // through the form does not light everything up.
  function touch(key: string, value: string) {
    if (!value.trim()) return;
    const message = computeErrors(step)[key];
    if (message) setErrors((prev) => (prev[key] === message ? prev : { ...prev, [key]: message }));
  }

  // Which child card is expanded; collapse the rest once there is more than one.
  const [expandedChild, setExpandedChild] = useState<number | null>(null);

  // Magnetic pull on the primary action button.
  const magnet = useMagnetic();

  // Restore a saved draft once on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (typeof d.step === "number") setStep(Math.min(Math.max(d.step, 0), STEPS.length - 1));
        if (d.geschlecht !== undefined) setGeschlecht(d.geschlecht);
        if (typeof d.vorname === "string") setVorname(d.vorname);
        if (typeof d.nachname === "string") setNachname(d.nachname);
        if (typeof d.geburtsdatum === "string") setGeburtsdatum(d.geburtsdatum);
        if (typeof d.strasse === "string") setStrasse(d.strasse);
        if (typeof d.hausnummer === "string") setHausnummer(d.hausnummer);
        if (typeof d.plz === "string") setPlz(d.plz);
        if (typeof d.ort === "string") setOrt(d.ort);
        if (typeof d.telefon === "string") setTelefon(d.telefon);
        if (typeof d.telefonOptOut === "boolean") setTelefonOptOut(d.telefonOptOut);
        if (typeof d.email === "string") setEmail(d.email);
        if (Array.isArray(d.selectedAbt)) setSelectedAbt(d.selectedAbt);
        if (typeof d.passive === "boolean") setPassive(d.passive);
        if (typeof d.erzVorname === "string") setErzVorname(d.erzVorname);
        if (typeof d.erzNachname === "string") setErzNachname(d.erzNachname);
        if (typeof d.elternteilMitglied === "boolean") setElternteilMitglied(d.elternteilMitglied);
        if (typeof d.partnerVorname === "string") setPartnerVorname(d.partnerVorname);
        if (typeof d.partnerNachname === "string") setPartnerNachname(d.partnerNachname);
        if (typeof d.partnerGeburtsdatum === "string")
          setPartnerGeburtsdatum(d.partnerGeburtsdatum);
        if (Array.isArray(d.partnerAbt)) setPartnerAbt(d.partnerAbt);
        if (Array.isArray(d.kinder)) setKinder(d.kinder);
        if (typeof d.kontoinhaber === "string") setKontoinhaber(d.kontoinhaber);
        if (typeof d.iban === "string") setIban(d.iban);
        if (typeof d.bic === "string") setBic(d.bic);
        if (typeof d.kreditinstitut === "string") setKreditinstitut(d.kreditinstitut);
        if (typeof d.signOnline === "boolean") setSignOnline(d.signOnline);
        if (typeof d.datenschutz === "boolean") setDatenschutz(d.datenschutz);
        if (typeof d.satzung === "boolean") setSatzung(d.satzung);
        setDraftState("restored");
        setTimeout(() => setDraftState("idle"), 4000);
      }
    } catch {
      // A corrupt draft should never block a fresh application.
    }
    setHydrated(true);
  }, []);

  const draftJson = JSON.stringify({
    step,
    geschlecht,
    vorname,
    nachname,
    geburtsdatum,
    strasse,
    hausnummer,
    plz,
    ort,
    telefon,
    telefonOptOut,
    email,
    selectedAbt,
    passive,
    erzVorname,
    erzNachname,
    elternteilMitglied,
    partnerVorname,
    partnerNachname,
    partnerGeburtsdatum,
    partnerAbt,
    kinder,
    kontoinhaber,
    iban,
    bic,
    kreditinstitut,
    signOnline,
    datenschutz,
    satzung,
  } satisfies Draft);

  // Debounced persistence of the draft after any change.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(DRAFT_KEY, draftJson);
        setDraftState("saved");
        setTimeout(() => setDraftState((s) => (s === "saved" ? "idle" : s)), 2000);
      } catch {
        // sessionStorage can be unavailable (private mode); not fatal.
      }
    }, 500);
    return () => clearTimeout(t);
  }, [draftJson, hydrated]);

  // A changed identity invalidates a previous duplicate acknowledgement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity fields only
  useEffect(() => {
    setDupAck(false);
  }, [vorname, nachname, geburtsdatum]);

  const dup = useMutation({
    mutationFn: () => orpc.applications.checkDuplicate({ vorname, nachname, geburtsdatum }),
  });

  // Live duplicate hint: once name and birth date are present, check in the
  // background (debounced) and warn softly. It never blocks; submission has its
  // own confirm step.
  useEffect(() => {
    const ready =
      vorname.trim().length >= 2 &&
      nachname.trim().length >= 2 &&
      /^\d{4}-\d{2}-\d{2}$/.test(geburtsdatum);
    if (!ready) {
      setDupHint(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await orpc.applications.checkDuplicate({ vorname, nachname, geburtsdatum });
        if (!cancelled) {
          setDupHint(
            r.duplicate
              ? "Zu diesem Namen und Geburtsdatum gibt es vielleicht schon einen Antrag oder eine Mitgliedschaft. Sie können trotzdem fortfahren."
              : null,
          );
        }
      } catch {
        // A failed background check should never surface as an error.
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vorname, nachname, geburtsdatum]);

  const age = geburtsdatum ? realAgeFromIso(geburtsdatum) : null;
  const isMinor = age != null && age < 18;
  const hasPartner = partnerVorname.trim().length >= 2 && partnerNachname.trim().length >= 2;
  // Show the family editors when the user opened them or when there is already
  // family data to edit (e.g. after a draft restore).
  const hasFamilieData =
    kinder.length > 0 ||
    partnerVorname.trim().length > 0 ||
    partnerNachname.trim().length > 0 ||
    partnerGeburtsdatum.length > 0;
  const familieExpanded = familieOpen || hasFamilieData;
  const antragstyp: "einzel" | "kind" | "familie" = isMinor
    ? "kind"
    : kinder.length > 0 && (hasPartner || !tenantPolicy.familyPartnerRequired)
      ? "familie"
      : "einzel";

  const fee = useQuery({
    queryKey: ["applications.calculateFee", geburtsdatum, antragstyp, elternteilMitglied],
    queryFn: () => orpc.applications.calculateFee({ geburtsdatum, antragstyp, elternteilMitglied }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(geburtsdatum),
  });

  // The person who pays and signs: the guardian for a minor, otherwise the
  // applicant. Used as the default account holder and on the SEPA mandate.
  const payerName = isMinor
    ? `${erzVorname} ${erzNachname}`.trim()
    : `${vorname} ${nachname}`.trim();

  // Default the account holder to the contact person when reaching SEPA.
  useEffect(() => {
    if (step === 1 && !kontoinhaber.trim() && payerName) {
      setKontoinhaber(payerName);
    }
  }, [step, kontoinhaber, payerName]);

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
        telefonOptOut,
        email: email || null,
        abteilungen: passive ? [] : selectedAbt,
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
    onSuccess: (res) => {
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setResult({ antragsnummer: res.antragsnummer });
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Der Antrag konnte nicht gesendet werden."),
  });

  // Final submit: run a soft duplicate check first. A hit does not block; it
  // warns once and a second click goes through (matching svums).
  async function handleSubmit() {
    setError(null);
    setWarning(null);
    if (!dupAck) {
      try {
        const r = await dup.mutateAsync();
        if (r.duplicate) {
          setDupAck(true);
          setWarning(
            "Es könnte bereits ein Antrag oder eine Mitgliedschaft mit diesem Namen und Geburtsdatum bestehen. Klicken Sie erneut auf „Beitritt erklären“, um trotzdem fortzufahren.",
          );
          return;
        }
      } catch {
        // Never block submission because the duplicate check itself failed.
      }
    }
    submit.mutate();
  }

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function childAge(iso: string): number | null {
    return realAgeFromIso(iso);
  }

  // Per-field validation for a step. Keys match the `f-<key>` anchor ids so the
  // first invalid field can be scrolled into view.
  function computeErrors(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!isMinor && !geschlecht) e.geschlecht = "Bitte eine Anrede wählen.";
      const vorErr = validateNameMessage(vorname, "Vorname");
      if (vorErr) e.vorname = vorErr;
      const nachErr = validateNameMessage(nachname, "Nachname");
      if (nachErr) e.nachname = nachErr;
      const dobErr = validatePastDateMessage(geburtsdatum, "Geburtsdatum", { maxAge: 120 });
      if (dobErr) e.geburtsdatum = dobErr;
      if (!passive && selectedAbt.length === 0) {
        e.abteilung = "Bitte mindestens eine Abteilung wählen oder passiv auswählen.";
      }
      if (!strasse.trim() || strasse.trim().length < 3)
        e.strasse = "Bitte eine vollständige Straße angeben.";
      const plzErr = validatePlzMessage(plz);
      if (plzErr) e.plz = plzErr;
      if (ort.trim().length < 2) e.ort = "Ort ist erforderlich.";
      const phoneErr = validatePhoneMessage(telefon, telefonOptOut);
      if (phoneErr) e.telefon = phoneErr;
      if (!EMAIL_RE.test(email.trim())) e.email = "Bitte eine gültige E-Mail-Adresse angeben.";
      if (isMinor) {
        const erzVorErr = validateNameMessage(erzVorname, "Vorname");
        if (erzVorErr) e.erzVorname = erzVorErr;
        const erzNachErr = validateNameMessage(erzNachname, "Nachname");
        if (erzNachErr) e.erzNachname = erzNachErr;
      }
      if (!isMinor && kinder.length > 0) {
        const partnerVorErr = validateNameMessage(partnerVorname, "Vorname des Partners");
        if (partnerVorErr) e.partnerVorname = partnerVorErr;
        const partnerNachErr = validateNameMessage(partnerNachname, "Nachname des Partners");
        if (partnerNachErr) e.partnerNachname = partnerNachErr;
        const partnerDobErr = validatePastDateMessage(
          partnerGeburtsdatum,
          "Geburtsdatum des Partners",
          { maxAge: 120 },
        );
        if (partnerDobErr) e.partnerGeburtsdatum = partnerDobErr;
        else if ((realAgeFromIso(partnerGeburtsdatum) ?? 0) < 18) {
          e.partnerGeburtsdatum = "Partner oder zweites Elternteil muss volljährig sein.";
        }
        kinder.forEach((k, i) => {
          const prefix = `kind_${i}`;
          const kv = validateNameMessage(k.vorname, "Vorname des Kindes");
          if (kv) e[`${prefix}_vorname`] = kv;
          const kn = validateNameMessage(k.nachname, "Nachname des Kindes");
          if (kn) e[`${prefix}_nachname`] = kn;
          const kd = validatePastDateMessage(k.geburtsdatum, "Geburtsdatum des Kindes");
          if (kd) e[`${prefix}_geburtsdatum`] = kd;
          else if ((childAge(k.geburtsdatum) ?? 99) > 18) {
            e[`${prefix}_geburtsdatum`] = "Kind muss 18 Jahre oder jünger sein.";
          }
          if (k.abteilungen.length === 0) {
            e[`${prefix}_abteilungen`] = "Bitte mindestens eine Abteilung wählen.";
          }
        });
      }
    }
    if (s === 1) {
      const ibanErr = validateIbanMessage(iban);
      if (ibanErr) e.iban = ibanErr;
      const bicErr = validateBicMessage(bic);
      if (bicErr) e.bic = bicErr;
    }
    return e;
  }

  const emailValid = EMAIL_RE.test(email.trim());
  const addressErrors = { strasse: errors.strasse, plz: errors.plz, ort: errors.ort };
  const addressValues: Record<AddressFieldKey, string> = { strasse, plz, ort };

  function goTo(target: number) {
    setDir(target > step ? "forward" : "backward");
    setStep(target);
  }

  function next() {
    const errs = computeErrors(step);
    setErrors(errs);
    const ordered = ERROR_ORDER.filter((k) => errs[k]);
    const keys = [...ordered, ...Object.keys(errs).filter((k) => !ordered.includes(k as never))];
    if (keys.length > 0) {
      setError(
        keys.length === 1
          ? "Bitte prüfen Sie das markierte Feld."
          : `Bitte prüfen Sie ${keys.length} markierte Felder.`,
      );
      setPulseNonce((n) => n + 1);
      const firstKey = keys[0];
      setTimeout(() => {
        const el = document.getElementById(`f-${firstKey}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus();
      }, 0);
      return;
    }
    setError(null);
    setErrors({});
    setDir("forward");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setError(null);
    setErrors({});
    setDir("backward");
    setStep((s) => Math.max(s - 1, 0));
  }

  const selectedAbtNames = passive
    ? ["Keine Abteilung / passiv"]
    : abteilungen.filter((a) => selectedAbt.includes(a.id)).map((a) => a.name);
  const tarifLabel =
    antragstyp === "familie" ? "Familienmitgliedschaft" : (fee.data?.label ?? null);

  if (result) {
    return (
      <SuccessScreen
        antragsnummer={result.antragsnummer}
        signOnline={signOnline}
        email={email}
        name={`${vorname} ${nachname}`.trim()}
        tarif={tarifLabel}
        jahresbeitrag={fee.data ? formatCurrency(fee.data.jahresbeitrag) : null}
        abteilungen={selectedAbtNames}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Stepper step={step} onJump={(i) => i < step && goTo(i)} />
        <p
          aria-live="polite"
          className={cn(
            "flex min-h-4 items-center gap-1.5 self-end text-xs text-muted-foreground transition-opacity duration-300",
            draftState === "idle" ? "opacity-0" : "opacity-100",
          )}
        >
          <Check className="size-3.5 text-success" />
          {draftState === "restored" ? "Entwurf wiederhergestellt" : "Entwurf gespeichert"}
        </p>
      </div>

      <div
        key={step}
        className={dir === "forward" ? "motion-step-forward" : "motion-step-backward"}
      >
        {step === 0 ? (
          <div className="flex flex-col gap-6">
            <IntroPanel />

            <p className="text-sm text-muted-foreground">
              Sie haben die Beitrittserklärung schon auf Papier ausgefüllt?{" "}
              <Link to="/antrag/papierformular" className="text-primary hover:underline">
                Scan hochladen
              </Link>
            </p>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Mitgliedsdaten</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Geben Sie die Daten der Person ein, die Mitglied werden soll. Der passende Tarif
                  wird automatisch anhand des Alters ermittelt.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Reveal open={!isMinor} collapsedClassName="-mb-4">
                  <div id="f-geschlecht" className="flex scroll-mt-24 flex-col gap-1.5">
                    <Label>Anrede *</Label>
                    <div className="flex flex-wrap gap-2">
                      {(["Herr", "Frau", "keine Angabe"] as Anrede[]).map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => {
                            setGeschlecht(a);
                            clearError("geschlecht");
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95",
                            geschlecht === a
                              ? "border-primary bg-primary/10 shadow-soft"
                              : "border-border text-muted-foreground hover:border-ring/40",
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    <FieldHelper error={errors.geschlecht} />
                  </div>
                </Reveal>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Vorname *"
                    anchorId="f-vorname"
                    state={fieldStateOf(
                      vorname,
                      validateNameMessage(vorname, "Vorname") === null,
                      errors.vorname,
                    )}
                    error={errors.vorname}
                    pulseNonce={pulseNonce}
                  >
                    <Input
                      value={vorname}
                      autoComplete="given-name"
                      onChange={(e) => {
                        setVorname(e.target.value);
                        clearError("vorname");
                      }}
                      onBlur={() => touch("vorname", vorname)}
                    />
                  </Field>
                  <Field
                    label="Nachname *"
                    anchorId="f-nachname"
                    state={fieldStateOf(
                      nachname,
                      validateNameMessage(nachname, "Nachname") === null,
                      errors.nachname,
                    )}
                    error={errors.nachname}
                    pulseNonce={pulseNonce}
                  >
                    <Input
                      value={nachname}
                      autoComplete="family-name"
                      onChange={(e) => {
                        setNachname(e.target.value);
                        clearError("nachname");
                      }}
                      onBlur={() => touch("nachname", nachname)}
                    />
                  </Field>
                  <Field
                    label="Geburtsdatum *"
                    anchorId="f-geburtsdatum"
                    state={fieldStateOf(
                      geburtsdatum,
                      validatePastDateMessage(geburtsdatum, "Geburtsdatum", { maxAge: 120 }) ===
                        null,
                      errors.geburtsdatum,
                    )}
                    error={errors.geburtsdatum}
                    pulseNonce={pulseNonce}
                  >
                    <DateField
                      value={geburtsdatum}
                      onChange={(v) => {
                        setGeburtsdatum(v);
                        clearError("geburtsdatum");
                      }}
                    />
                  </Field>
                  <div />
                </div>
                <Reveal open={Boolean(dupHint)} collapsedClassName="-mt-4">
                  <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    {dupHint}
                  </p>
                </Reveal>

                <AddressFields
                  strasse={strasse}
                  hausnummer={hausnummer}
                  plz={plz}
                  ort={ort}
                  onStrasse={(v) => {
                    setStrasse(v);
                    clearError("strasse");
                  }}
                  onHausnummer={setHausnummer}
                  onPlz={(v) => {
                    setPlz(v);
                    clearError("plz");
                  }}
                  onOrt={(v) => {
                    setOrt(v);
                    clearError("ort");
                  }}
                  errors={addressErrors}
                  onBlurField={(key) => touch(key, addressValues[key])}
                  pulseNonce={pulseNonce}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Field
                      label="Telefon *"
                      anchorId="f-telefon"
                      state={fieldStateOf(
                        telefon,
                        !telefonOptOut && validatePhoneMessage(telefon) === null,
                        errors.telefon,
                      )}
                      error={errors.telefon}
                      pulseNonce={pulseNonce}
                      hint={telefonOptOut ? "Keine Telefonnummer gewünscht." : undefined}
                    >
                      <Input
                        type="tel"
                        value={telefon}
                        autoComplete="tel"
                        disabled={telefonOptOut}
                        onChange={(e) => {
                          setTelefon(e.target.value);
                          clearError("telefon");
                        }}
                        onBlur={() => touch("telefon", telefon)}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={telefonOptOut}
                        onChange={(e) => {
                          setTelefonOptOut(e.target.checked);
                          if (e.target.checked) setTelefon("");
                          clearError("telefon");
                        }}
                      />
                      Ich möchte keine Telefonnummer angeben
                    </label>
                  </div>
                  <Field
                    label="E-Mail *"
                    anchorId="f-email"
                    state={fieldStateOf(email, emailValid, errors.email)}
                    error={errors.email}
                    pulseNonce={pulseNonce}
                    hint="Für die Bestätigung und Rückfragen zum Antrag."
                  >
                    <Input
                      type="email"
                      value={email}
                      autoComplete="email"
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearError("email");
                      }}
                      onBlur={() => touch("email", email)}
                    />
                  </Field>
                </div>

                <Reveal open={age != null} collapsedClassName="-mt-4">
                  <FeeCard
                    tarif={tarifLabel}
                    betrag={fee.data ? formatCurrency(fee.data.jahresbeitrag) : null}
                    isMinor={isMinor}
                    loading={fee.isLoading}
                  />
                </Reveal>
              </CardContent>
            </Card>

            <Reveal open={isMinor} collapsedClassName="-mt-6">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Gesetzliche Vertretung</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Diese Person unterschreibt die Beitrittserklärung, erteilt das SEPA-Mandat und
                    ist Ansprechpartner für den Verein.
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Vorname *"
                      anchorId="f-erzVorname"
                      state={fieldStateOf(
                        erzVorname,
                        validateNameMessage(erzVorname, "Vorname") === null,
                        errors.erzVorname,
                      )}
                      error={errors.erzVorname}
                      pulseNonce={pulseNonce}
                    >
                      <Input
                        value={erzVorname}
                        onChange={(e) => {
                          setErzVorname(e.target.value);
                          clearError("erzVorname");
                        }}
                        onBlur={() => touch("erzVorname", erzVorname)}
                      />
                    </Field>
                    <Field
                      label="Nachname *"
                      anchorId="f-erzNachname"
                      state={fieldStateOf(
                        erzNachname,
                        validateNameMessage(erzNachname, "Nachname") === null,
                        errors.erzNachname,
                      )}
                      error={errors.erzNachname}
                      pulseNonce={pulseNonce}
                    >
                      <Input
                        value={erzNachname}
                        onChange={(e) => {
                          setErzNachname(e.target.value);
                          clearError("erzNachname");
                        }}
                        onBlur={() => touch("erzNachname", erzNachname)}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={elternteilMitglied}
                        onChange={(e) => setElternteilMitglied(e.target.checked)}
                      />
                      Ein Elternteil ist bereits Mitglied
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Falls ja, erhalten Kinder und Jugendliche einen vergünstigten Beitrag.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            <Card id="f-abteilung" className="glass-card scroll-mt-24">
              <CardHeader>
                <CardTitle>Abteilungen</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Mehrfachauswahl ist möglich. Wählen Sie passiv, wenn Sie den Verein ohne Abteilung
                  unterstützen möchten.
                </p>
              </CardHeader>
              <CardContent>
                <AbteilungPicker
                  abteilungen={abteilungen}
                  selected={selectedAbt}
                  passive={passive}
                  onPassiveChange={(active) => {
                    setPassive(active);
                    if (active) setSelectedAbt([]);
                    clearError("abteilung");
                  }}
                  onToggle={(id) => {
                    if (passive) setPassive(false);
                    toggle(selectedAbt, setSelectedAbt, id);
                    clearError("abteilung");
                  }}
                />
                <div className="mt-2">
                  <FieldHelper error={errors.abteilung} />
                </div>
              </CardContent>
            </Card>

            <Reveal open={!isMinor} collapsedClassName="-mt-6">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Familie (optional)</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Die Familienmitgliedschaft gilt für zwei Erwachsene und beliebig viele Kinder
                    bis 18 Jahre, unabhängig von der Kinderzahl. Tragen Sie dazu einen Partner oder
                    ein zweites Elternteil und mindestens ein Kind ein.
                  </p>
                </CardHeader>
                <Reveal open={!familieExpanded}>
                  <CardContent>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => setFamilieOpen(true)}
                    >
                      <Users className="size-4" /> Familienmitglieder hinzufügen
                    </Button>
                  </CardContent>
                </Reveal>
                <Reveal open={familieExpanded}>
                  <CardContent className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label="Partner Vorname"
                        anchorId="f-partnerVorname"
                        error={errors.partnerVorname}
                        pulseNonce={pulseNonce}
                        state={fieldStateOf(
                          partnerVorname,
                          validateNameMessage(partnerVorname, "Vorname") === null,
                          errors.partnerVorname,
                        )}
                      >
                        <Input
                          value={partnerVorname}
                          onChange={(e) => {
                            setPartnerVorname(e.target.value);
                            clearError("partnerVorname");
                          }}
                          onBlur={() => touch("partnerVorname", partnerVorname)}
                        />
                      </Field>
                      <Field
                        label="Partner Nachname"
                        anchorId="f-partnerNachname"
                        error={errors.partnerNachname}
                        pulseNonce={pulseNonce}
                        state={fieldStateOf(
                          partnerNachname,
                          validateNameMessage(partnerNachname, "Nachname") === null,
                          errors.partnerNachname,
                        )}
                      >
                        <Input
                          value={partnerNachname}
                          onChange={(e) => {
                            setPartnerNachname(e.target.value);
                            clearError("partnerNachname");
                          }}
                          onBlur={() => touch("partnerNachname", partnerNachname)}
                        />
                      </Field>
                      <Field
                        label="Partner Geburtsdatum"
                        anchorId="f-partnerGeburtsdatum"
                        error={errors.partnerGeburtsdatum}
                        pulseNonce={pulseNonce}
                        state={fieldStateOf(
                          partnerGeburtsdatum,
                          (realAgeFromIso(partnerGeburtsdatum) ?? 0) >= 18,
                          errors.partnerGeburtsdatum,
                        )}
                      >
                        <DateField
                          value={partnerGeburtsdatum}
                          onChange={(v) => {
                            setPartnerGeburtsdatum(v);
                            clearError("partnerGeburtsdatum");
                          }}
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
                      {kinder.map((k, i) => {
                        // Collapse other cards once there is more than one child;
                        // a single child always stays open.
                        const collapsible = kinder.length > 1;
                        const open = !collapsible || expandedChild === i;
                        const childName = `${k.vorname} ${k.nachname}`.trim();
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and short-lived.
                          <div key={`kind-${i}`} className="rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                aria-expanded={open}
                                disabled={!collapsible}
                                onClick={() => setExpandedChild(open ? null : i)}
                                className={cn(
                                  "flex min-w-0 items-center gap-1.5 text-sm font-medium",
                                  collapsible ? "cursor-pointer" : "cursor-default",
                                )}
                              >
                                {collapsible ? (
                                  <ChevronDown
                                    className={cn(
                                      "size-4 shrink-0 text-muted-foreground transition-transform",
                                      open ? "" : "-rotate-90",
                                    )}
                                  />
                                ) : null}
                                <span className="truncate">
                                  Kind {i + 1}
                                  {!open && childName ? (
                                    <span className="font-normal text-muted-foreground">
                                      {" "}
                                      · {childName}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label="Kind entfernen"
                                onClick={() => {
                                  setKinder((prev) => prev.filter((_, j) => j !== i));
                                  setExpandedChild(null);
                                }}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                            <Reveal open={open}>
                              <div className="mt-3 flex flex-col gap-2">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <Field
                                    label="Vorname"
                                    anchorId={`f-kind_${i}_vorname`}
                                    error={errors[`kind_${i}_vorname`]}
                                    pulseNonce={pulseNonce}
                                    state={fieldStateOf(
                                      k.vorname,
                                      validateNameMessage(k.vorname, "Vorname") === null,
                                      errors[`kind_${i}_vorname`],
                                    )}
                                  >
                                    <Input
                                      value={k.vorname}
                                      onChange={(e) => {
                                        updateKind(setKinder, i, { vorname: e.target.value });
                                        clearError(`kind_${i}_vorname`);
                                      }}
                                      onBlur={() => touch(`kind_${i}_vorname`, k.vorname)}
                                    />
                                  </Field>
                                  <Field
                                    label="Nachname"
                                    anchorId={`f-kind_${i}_nachname`}
                                    error={errors[`kind_${i}_nachname`]}
                                    pulseNonce={pulseNonce}
                                    state={fieldStateOf(
                                      k.nachname,
                                      validateNameMessage(k.nachname, "Nachname") === null,
                                      errors[`kind_${i}_nachname`],
                                    )}
                                  >
                                    <Input
                                      value={k.nachname}
                                      onChange={(e) => {
                                        updateKind(setKinder, i, { nachname: e.target.value });
                                        clearError(`kind_${i}_nachname`);
                                      }}
                                      onBlur={() => touch(`kind_${i}_nachname`, k.nachname)}
                                    />
                                  </Field>
                                  <Field
                                    label="Geburtsdatum"
                                    anchorId={`f-kind_${i}_geburtsdatum`}
                                    error={errors[`kind_${i}_geburtsdatum`]}
                                    pulseNonce={pulseNonce}
                                    state={fieldStateOf(
                                      k.geburtsdatum,
                                      (childAge(k.geburtsdatum) ?? 99) <= 18,
                                      errors[`kind_${i}_geburtsdatum`],
                                    )}
                                  >
                                    <DateField
                                      value={k.geburtsdatum}
                                      onChange={(v) => {
                                        updateKind(setKinder, i, { geburtsdatum: v });
                                        clearError(`kind_${i}_geburtsdatum`);
                                      }}
                                    />
                                  </Field>
                                </div>
                                <AbteilungPicker
                                  abteilungen={abteilungen}
                                  selected={k.abteilungen}
                                  onToggle={(id) => {
                                    updateKind(setKinder, i, {
                                      abteilungen: k.abteilungen.includes(id)
                                        ? k.abteilungen.filter((x) => x !== id)
                                        : [...k.abteilungen, id],
                                    });
                                    clearError(`kind_${i}_abteilungen`);
                                  }}
                                />
                                <FieldHelper error={errors[`kind_${i}_abteilungen`]} />
                              </div>
                            </Reveal>
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => {
                          // Adding the first child implies a family, so pre-fill the
                          // partner's last name from the applicant when still empty.
                          if (!partnerNachname.trim()) setPartnerNachname(nachname.trim());
                          setKinder((prev) => {
                            setExpandedChild(prev.length);
                            return [
                              ...prev,
                              {
                                vorname: "",
                                nachname: nachname.trim(),
                                geburtsdatum: "",
                                abteilungen: [],
                              },
                            ];
                          });
                        }}
                      >
                        <Plus className="size-4" /> Kind hinzufügen
                      </Button>
                      {kinder.length > 0 && tenantPolicy.familyPartnerRequired && !hasPartner ? (
                        <p className="text-xs text-muted-foreground">
                          Für den Familientarif bitte oben einen Partner oder ein zweites Elternteil
                          eintragen. Bis dahin gilt Ihr Einzelbeitrag.
                        </p>
                      ) : null}
                    </div>
                    {!hasFamilieData ? (
                      <button
                        type="button"
                        onClick={() => setFamilieOpen(false)}
                        className="self-start text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        Familienangaben ausblenden
                      </button>
                    ) : null}
                  </CardContent>
                </Reveal>
              </Card>
            </Reveal>
          </div>
        ) : null}

        {step === 1 ? (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                SEPA-Lastschriftmandat
                <HelpTip text="Mit dem Mandat erlauben Sie dem Verein, den Jahresbeitrag von Ihrem Konto einzuziehen. Sie können einer Abbuchung innerhalb von acht Wochen widersprechen." />
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Zahlungspflichtig:{" "}
                <span className="font-medium text-foreground">{payerName || EMPTY_VALUE}</span>. Der
                Jahresbeitrag wird einmal jährlich per SEPA-Lastschrift eingezogen. BIC und
                Kreditinstitut werden nach IBAN-Eingabe automatisch ermittelt.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Gläubiger-ID</span>
                  <span className="text-right font-mono">
                    {orEmpty(settings.data?.glaeubigerId)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Mandatsreferenz</span>
                  <span className="text-right italic text-muted-foreground">
                    wird automatisch vergeben
                  </span>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Ich ermächtige {vereinsname} widerruflich, die von mir zu entrichtenden Zahlungen
                von meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein
                Kreditinstitut an, die von {vereinsname} auf mein Konto gezogenen Lastschriften
                einzulösen. Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum,
                die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem
                Kreditinstitut vereinbarten Bedingungen.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Kontoinhaber"
                  hint="Nur ändern, wenn das Konto auf einen anderen Namen läuft."
                  state={fieldStateOf(kontoinhaber, kontoinhaber.trim().length >= 2)}
                >
                  <Input
                    value={kontoinhaber}
                    placeholder={payerName}
                    autoComplete="name"
                    onChange={(e) => setKontoinhaber(e.target.value)}
                  />
                </Field>
                <div />
                <IbanField
                  value={iban}
                  onChange={(v) => {
                    setIban(v);
                    clearError("iban");
                  }}
                  error={errors.iban}
                  pulseNonce={pulseNonce}
                  onResolved={(info) => {
                    if (info.bic) setBic(info.bic);
                    if (info.name) setKreditinstitut(info.name);
                    clearError("bic");
                  }}
                />
                <Field
                  label="BIC"
                  anchorId="f-bic"
                  hint="Wird nach IBAN-Eingabe automatisch ergänzt."
                  error={errors.bic}
                  pulseNonce={pulseNonce}
                  state={fieldStateOf(bic, validateBicMessage(bic) === null, errors.bic)}
                >
                  <Input
                    value={bic}
                    autoComplete="off"
                    onChange={(e) => {
                      setBic(e.target.value.toUpperCase());
                      clearError("bic");
                    }}
                    onBlur={() => touch("bic", bic)}
                  />
                </Field>
                <Field
                  label="Kreditinstitut"
                  hint="Wird nach IBAN-Eingabe automatisch ergänzt."
                  state={fieldStateOf(kreditinstitut, kreditinstitut.trim().length >= 2)}
                >
                  <Input
                    value={kreditinstitut}
                    onChange={(e) => setKreditinstitut(e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Zusammenfassung</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Bitte prüfen Sie Ihre Angaben. Wählen Sie anschließend, wie Sie die
                  Beitrittserklärung unterzeichnen möchten.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 text-sm">
                <SummarySection title="Antragsteller" onEdit={() => goTo(0)}>
                  {!isMinor && geschlecht ? <Row label="Anrede">{geschlecht}</Row> : null}
                  <Row label="Name">{orEmpty(`${vorname} ${nachname}`.trim())}</Row>
                  <Row label="Geburtsdatum">{orEmpty(formatDate(geburtsdatum))}</Row>
                  <Row label="Adresse">
                    {orEmpty(
                      [`${strasse} ${hausnummer}`.trim(), `${plz} ${ort}`.trim()]
                        .filter((s) => s.trim())
                        .join(", "),
                    )}
                  </Row>
                  {telefon ? <Row label="Telefon">{telefon}</Row> : null}
                  <Row label="E-Mail">{orEmpty(email)}</Row>
                  <Row label="Abteilungen">{orEmpty(selectedAbtNames.join(", "))}</Row>
                </SummarySection>

                {isMinor ? (
                  <SummarySection title="Gesetzliche Vertretung" onEdit={() => goTo(0)}>
                    {geschlecht ? <Row label="Anrede">{geschlecht}</Row> : null}
                    <Row label="Name">{orEmpty(`${erzVorname} ${erzNachname}`.trim())}</Row>
                    <Row label="Elternteil Mitglied">{elternteilMitglied ? "Ja" : "Nein"}</Row>
                  </SummarySection>
                ) : null}

                {antragstyp === "familie" ? (
                  <SummarySection title={`Kinder (${kinder.length})`} onEdit={() => goTo(0)}>
                    {kinder.map((k, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional summary rows.
                      <Row key={`sk-${i}`} label={`Kind ${i + 1}`}>
                        {orEmpty(
                          `${k.vorname} ${k.nachname}`.trim() +
                            (k.geburtsdatum ? `, ${formatDate(k.geburtsdatum)}` : ""),
                        )}
                      </Row>
                    ))}
                  </SummarySection>
                ) : null}

                <SummarySection title="Mitgliedschaft" onEdit={() => goTo(0)}>
                  <Row label="Tarif">{orEmpty(fee.data?.label)}</Row>
                  <Row label="Jahresbeitrag">
                    {fee.data ? formatCurrency(fee.data.jahresbeitrag) : EMPTY_VALUE}
                  </Row>
                </SummarySection>

                <SummarySection title="SEPA-Lastschrift" onEdit={() => goTo(1)}>
                  <Row label="Kontoinhaber">{orEmpty(kontoinhaber || payerName)}</Row>
                  <Row label="IBAN">{orEmpty(iban)}</Row>
                  {bic ? <Row label="BIC">{bic}</Row> : null}
                  {kreditinstitut ? <Row label="Kreditinstitut">{kreditinstitut}</Row> : null}
                </SummarySection>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Unterschrift</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Mit Ihrer Unterschrift erklären Sie Ihren Beitritt zu {vereinsname} und erteilen
                  das SEPA-Lastschriftmandat zur Einziehung des Mitgliedsbeitrags.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="overflow-hidden rounded-lg border border-border">
                  <SignChoice
                    active={signOnline}
                    onClick={() => setSignOnline(true)}
                    title="Jetzt direkt online unterschreiben"
                    badge="Standard"
                    description="Zeichnen Sie Ihre Unterschrift im Browser. Der Antrag wird sofort als unterzeichnet eingereicht, kein Upload nötig."
                  />
                  <SignChoice
                    active={!signOnline}
                    onClick={() => setSignOnline(false)}
                    title="PDF erhalten, drucken, unterschreiben und hochladen"
                    description="Sie erhalten das Dokument per E-Mail, unterschreiben es handschriftlich und laden den Scan über den Link in der E-Mail wieder hoch."
                  />
                </div>
                {signOnline ? (
                  <div className="flex flex-col gap-2">
                    <SignaturePad value={signature} onChange={setSignature} />
                    {signature ? (
                      <p className="motion-fade-in flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="motion-pop-in size-3.5" /> Unterschrift
                        gespeichert. Sie können den Antrag jetzt absenden.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Zeichnen Sie Ihre Unterschrift mit der Maus oder dem Finger.
                      </p>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="glass-card">
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
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Ein Austritt ist nur zum Ende eines Kalenderjahres unter Einhaltung einer Frist
                  von sechs Wochen in Textform möglich.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      <Reveal open={Boolean(warning)} collapsedClassName="-mt-6">
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          {warning}
        </p>
      </Reveal>
      <Reveal open={Boolean(error)} collapsedClassName="-mt-6">
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </p>
      </Reveal>

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          className="btn-spring"
          onClick={back}
          disabled={step === 0 || submit.isPending}
        >
          <ChevronLeft className="size-4" /> Zurück
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            ref={magnet.ref}
            type="button"
            className="btn-spring btn-magnetic"
            onPointerMove={magnet.onPointerMove}
            onPointerLeave={magnet.onPointerLeave}
            onClick={next}
          >
            Weiter <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button
            ref={magnet.ref}
            type="button"
            className="btn-spring btn-magnetic"
            onPointerMove={magnet.onPointerMove}
            onPointerLeave={magnet.onPointerLeave}
            disabled={
              submit.isPending ||
              dup.isPending ||
              !datenschutz ||
              !satzung ||
              (signOnline && !signature)
            }
            onClick={handleSubmit}
          >
            {submit.isPending || dup.isPending ? (
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

const INTRO_STEPS = [
  { icon: ClipboardList, title: "Daten eingeben", note: "Mitglied, Adresse und Abteilungen" },
  { icon: CreditCard, title: "Bankdaten", note: "SEPA-Lastschrift für den Beitrag" },
  { icon: PenLine, title: "Prüfen & absenden", note: "Unterschreiben, fertig" },
];

function IntroPanel() {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <p className="mb-3 text-sm font-medium">So funktioniert's: drei einfache Schritte</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {INTRO_STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="motion-reveal-up flex items-start gap-2.5"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <div>
                <div className="text-sm font-medium leading-tight">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.note}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeeCard({
  tarif,
  betrag,
  isMinor,
  loading,
}: {
  tarif: string | null;
  betrag: string | null;
  isMinor: boolean;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <CheckCircle2 className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Automatisch erkannter Tarif
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-base font-semibold">
            {tarif ?? (loading ? "wird ermittelt…" : EMPTY_VALUE)}
          </span>
          {betrag ? (
            <span key={betrag} className="motion-pop-in text-lg font-bold text-primary">
              {betrag} pro Jahr
            </span>
          ) : null}
        </div>
        {isMinor ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Die Angaben einer gesetzlichen Vertretung sind erforderlich.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={!done}
              className={cn(
                "flex items-center gap-2 text-left",
                done ? "cursor-pointer" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  done || current
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="motion-pop-in size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm sm:inline",
                  current ? "font-medium" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 ? (
              <span className="mx-2 h-px flex-1 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full bg-primary transition-all duration-300"
                  style={{ width: done ? "100%" : "0%" }}
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
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

function SummarySection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Pencil className="size-3" /> Bearbeiten
        </button>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function SignChoice({
  active,
  onClick,
  title,
  description,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border p-4 text-left transition-colors last:border-b-0",
        active ? "bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          active ? "border-primary" : "border-muted-foreground/40",
        )}
      >
        {active ? <span className="motion-pop-in size-2.5 rounded-full bg-primary" /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal text-primary">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

const CONFETTI_COLORS = [
  "hsl(40 52% 54%)",
  "hsl(38 92% 50%)",
  "hsl(152 60% 36%)",
  "hsl(216 52% 45%)",
];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.6,
        duration: 2.4 + Math.random() * 1.6,
        rot: 360 + Math.random() * 540,
      })),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              backgroundColor: p.color,
              "--confetti-delay": `${p.delay}s`,
              "--confetti-dur": `${p.duration}s`,
              "--confetti-rot": `${p.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function SuccessCheck() {
  return (
    <svg
      className="success-check size-20"
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Erfolgreich eingereicht"
    >
      <circle
        className="success-ring"
        cx="32"
        cy="32"
        r="28"
        stroke="var(--color-success)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        className="success-tick"
        d="M20 33l8 8 16-17"
        stroke="var(--color-success)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SuccessScreen({
  antragsnummer,
  signOnline,
  email,
  name,
  tarif,
  jahresbeitrag,
  abteilungen,
}: {
  antragsnummer: string;
  signOnline: boolean;
  email: string;
  name: string;
  tarif: string | null;
  jahresbeitrag: string | null;
  abteilungen: string[];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(antragsnummer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the number is shown anyway.
    }
  }

  const timeline = [
    {
      icon: Mail,
      title: "Bestätigung per E-Mail",
      note: email ? `An ${email}, in wenigen Minuten.` : "In wenigen Minuten.",
      done: true,
    },
    {
      icon: PenLine,
      title: signOnline ? "Digital unterschrieben" : "PDF drucken, unterschreiben und hochladen",
      note: signOnline
        ? "Erledigt. Kein weiterer Schritt nötig."
        : "Den Scan über den Link in der E-Mail hochladen.",
      done: signOnline,
    },
    {
      icon: Clock,
      title: "Prüfung durch den Verein",
      note: "Ihr Antrag wird geprüft und bestätigt. Das dauert wenige Werktage.",
      done: false,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Confetti />
      <Card className="motion-reveal-up overflow-hidden">
        <CardContent className="flex flex-col items-center gap-4 px-6 pt-8 pb-6 text-center">
          <SuccessCheck />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Vielen Dank für Ihre Beitrittserklärung
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ihr Antrag wurde erfolgreich eingereicht.
            </p>
          </div>

          <div className="flex w-full max-w-sm items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-left">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Antragsnummer
              </div>
              <div className="font-mono text-base font-semibold">{antragsnummer}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copy}
              aria-label="Antragsnummer kopieren"
            >
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
          </div>

          <div className="flex w-full max-w-sm flex-col gap-1.5 text-left text-sm">
            {name ? <Row label="Name">{name}</Row> : null}
            {abteilungen.length ? <Row label="Abteilungen">{abteilungen.join(", ")}</Row> : null}
            {tarif ? <Row label="Tarif">{tarif}</Row> : null}
            {jahresbeitrag ? <Row label="Jahresbeitrag">{jahresbeitrag}</Row> : null}
          </div>
        </CardContent>
      </Card>

      <Card className="motion-reveal-up" style={{ animationDelay: "120ms" } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="text-base">So geht es weiter</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {timeline.map((t, i) => {
            const Icon = t.icon;
            return (
              <div key={t.title} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      t.done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t.done ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  {i < timeline.length - 1 ? <span className="my-1 w-px flex-1 bg-border" /> : null}
                </div>
                <div className="pb-1">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{t.note}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/antrag/status"
          search={{ nr: antragsnummer }}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground shadow-soft transition-all hover:bg-accent"
        >
          <ArrowRight className="size-4" /> Status verfolgen
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/antrag/")({
  component: AntragForm,
});
