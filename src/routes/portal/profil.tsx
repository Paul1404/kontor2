import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { SkeletonText } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import {
  validateNameMessage,
  validatePhoneMessage,
  validatePlzMessage,
} from "~/lib/application-validation";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/portal/profil")({
  component: PortalProfilePage,
});

const FIELDS = [
  { key: "anrede", label: "Anrede" },
  { key: "vorname", label: "Vorname" },
  { key: "nachname", label: "Nachname" },
  { key: "strasse", label: "Straße" },
  { key: "hausnummer", label: "Hausnr." },
  { key: "plz", label: "PLZ" },
  { key: "ort", label: "Ort" },
  { key: "land", label: "Land" },
  { key: "telefon1", label: "Telefon" },
  { key: "telefon2", label: "Mobil" },
  { key: "email", label: "E-Mail" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
const SALUTATIONS = ["Herr", "Frau", "keine Angabe"] as const;

function PortalProfilePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const bypassBlocker = useRef(false);
  const me = useQuery({
    queryKey: ["portal.me"],
    queryFn: () => orpc.portal.me(),
    retry: false,
  });
  const [form, setForm] = useState<Record<FieldKey, string>>({
    anrede: "",
    vorname: "",
    nachname: "",
    strasse: "",
    hausnummer: "",
    plz: "",
    ort: "",
    land: "",
    telefon1: "",
    telefon2: "",
    email: "",
  });

  useEffect(() => {
    if (!me.data?.member) return;
    const m = me.data.member;
    setForm({
      anrede: m.anrede ?? "",
      vorname: m.vorname ?? "",
      nachname: m.nachname ?? "",
      strasse: m.strasse ?? "",
      hausnummer: m.hausnummer ?? "",
      plz: m.plz ?? "",
      ort: m.ort ?? "",
      land: m.land ?? "",
      telefon1: m.telefon1 ?? "",
      telefon2: m.telefon2 ?? "",
      email: m.email ?? "",
    });
  }, [me.data]);

  const submit = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | null> = {};
      for (const f of FIELDS) {
        const original = (me.data?.member?.[f.key] as string | null | undefined) ?? "";
        const next = form[f.key];
        if (original !== next) payload[f.key] = next.trim() === "" ? null : next.trim();
      }
      return orpc.portal.submitChanges(payload);
    },
    onSuccess: (r) => {
      bypassBlocker.current = true;
      toast.success(`Vorschlag eingereicht (${r.fieldCount} Feld(er)).`, {
        description: "Der Vorstand prüft die Änderungen.",
      });
      qc.invalidateQueries({ queryKey: ["portal.me"] });
      navigate({ to: "/portal" });
    },
    onError: (e: Error) =>
      toast.error("Konnte nicht eingereicht werden", { description: e.message }),
  });

  const dirtyCount = FIELDS.reduce((n, f) => {
    const original = (me.data?.member?.[f.key] as string | null | undefined) ?? "";
    return original !== form[f.key] ? n + 1 : n;
  }, 0);
  const errors = validateForm(form, me.data?.member ?? null);
  useBlocker({
    disabled: dirtyCount === 0,
    enableBeforeUnload: () => dirtyCount > 0 && !bypassBlocker.current,
    shouldBlockFn: () =>
      bypassBlocker.current
        ? false
        : !window.confirm("Ihre Änderungen sind noch nicht gespeichert. Seite trotzdem verlassen?"),
  });

  if (me.isLoading) {
    return <SkeletonText lines={5} className="max-w-md" />;
  }
  if (me.isError) {
    return <QueryError error={me.error} onRetry={() => me.refetch()} />;
  }
  if (!me.data?.member) {
    return (
      <p className="text-sm text-muted-foreground">
        Sie sind nicht angemeldet.{" "}
        <Link to="/portal" className="underline">
          Zur Startseite
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/portal" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" /> Übersicht
          </Link>
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Daten bearbeiten</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ändern Sie die Felder, die Sie aktualisieren möchten. Beim Absenden geht ein Vorschlag an
          den Vorstand. Die Daten werden erst nach Prüfung übernommen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Persönliche Daten</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label
                htmlFor={f.key}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {f.label}
              </label>
              {f.key === "anrede" ? (
                <select
                  id={f.key}
                  value={form[f.key]}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm"
                >
                  <option value="">Keine Angabe</option>
                  {SALUTATIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={f.key}
                  type={f.key === "email" ? "email" : "text"}
                  inputMode={f.key === "plz" || f.key.startsWith("telefon") ? "tel" : undefined}
                  autoComplete={autoCompleteFor(f.key)}
                  value={form[f.key]}
                  aria-invalid={Boolean(errors[f.key])}
                  aria-describedby={errors[f.key] ? `${f.key}-error` : undefined}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
              {errors[f.key] ? (
                <p id={`${f.key}-error`} className="text-xs text-destructive">
                  {errors[f.key]}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-accent/40 p-4">
        <div className="flex items-center gap-3 text-sm">
          <ShieldCheck className="size-5 text-success" />
          <div>
            <p className="font-medium">Datenschutz</p>
            <p className="text-xs text-muted-foreground">
              Ihre Eingaben werden verschlüsselt übertragen und nur vom Vorstand gelesen.
            </p>
          </div>
        </div>
        <Button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || dirtyCount === 0 || Object.keys(errors).length > 0}
        >
          <Save className="size-4" /> Vorschlag absenden
        </Button>
      </div>
    </div>
  );
}

function validateForm(
  form: Record<FieldKey, string>,
  original: Partial<Record<FieldKey, string | null>> | null,
): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  const changed = (key: FieldKey) => (original?.[key] ?? "") !== form[key];
  if (changed("vorname"))
    errors.vorname = validateNameMessage(form.vorname, "Vorname") ?? undefined;
  if (changed("nachname"))
    errors.nachname = validateNameMessage(form.nachname, "Nachname") ?? undefined;
  if (changed("email") && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Bitte eine gültige E-Mail-Adresse eingeben.";
  }
  if (changed("plz") && form.plz.trim() && !form.land.trim().match(/^(?!de$|d$|deutschland$)/i)) {
    // Foreign postal codes are intentionally not constrained to five digits.
  } else if (changed("plz") && form.plz.trim()) {
    errors.plz = validatePlzMessage(form.plz) ?? undefined;
  }
  for (const key of ["telefon1", "telefon2"] as const) {
    if (changed(key) && form[key].trim()) {
      errors[key] = validatePhoneMessage(form[key], true) ?? undefined;
    }
  }
  if (changed("anrede") && form.anrede && !SALUTATIONS.includes(form.anrede as never)) {
    errors.anrede = "Bitte eine gültige Anrede wählen.";
  }
  return Object.fromEntries(Object.entries(errors).filter(([, value]) => value)) as Partial<
    Record<FieldKey, string>
  >;
}

function autoCompleteFor(key: FieldKey): string | undefined {
  const map: Partial<Record<FieldKey, string>> = {
    vorname: "given-name",
    nachname: "family-name",
    strasse: "address-line1",
    hausnummer: "address-line2",
    plz: "postal-code",
    ort: "address-level2",
    land: "country-name",
    telefon1: "tel",
    telefon2: "tel",
    email: "email",
  };
  return map[key];
}
