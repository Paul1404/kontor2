import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Building2, CheckCircle2, Loader2, Palette, Save, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { useBranding } from "~/lib/branding";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/verein")({
  component: VereinsdatenPage,
});

type Msg = { kind: "ok" | "error"; text: string };

type Staffel = {
  familie: string;
  kind: string;
  kindElternMitglied: string;
  jugendlich: string;
  jugendlichElternMitglied: string;
  jungerErwachsener: string;
  erwachsener: string;
};

// Local copy of the default schedule. The server schema also defines this, but
// importing it here would pull server-only Drizzle code into the client bundle.
const DEFAULT_STAFFEL: Staffel = {
  familie: "96.00",
  kind: "24.00",
  kindElternMitglied: "12.00",
  jugendlich: "36.00",
  jugendlichElternMitglied: "24.00",
  jungerErwachsener: "42.00",
  erwachsener: "54.00",
};

function VereinsdatenPage() {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["organization", "edit"],
    queryFn: () => orpc.organization.getForEdit(),
  });

  const [form, setForm] = useState({
    vereinsname: "",
    anschriftStrasse: "",
    anschriftPlz: "",
    anschriftOrt: "",
    anschriftLand: "DE",
    glaeubigerId: "",
    vereinsIban: "",
    vereinsBic: "",
    vereinsBankname: "",
    defaultFalligkeitTag: 15,
    mahngebuhr1: "0",
    mahngebuhr2: "5",
    mahngebuhr3: "10",
    sepaReturnFee: "3.00",
    mahnFristTage: 14,
    beitragModus: "voll" as "voll" | "anteilig",
    anteilEinheit: "monat" as "monat" | "tag",
    kuendigungsfristAktiv: false,
    kuendigungsfristTage: 0,
    kuendigungZumMonatsende: false,
    kontaktEmail: "",
    mitgliedschaftEmail: "",
    kontaktTelefon: "",
    datenschutzUrl: "",
    satzungUrl: "",
    mandatsreferenzPrefix: "SVUWV-",
    beitragsstaffel: DEFAULT_STAFFEL,
    antragBenachrichtigungAktiv: true,
    antragVorstandEmail: "",
    antragGegenzeichnungBild: "",
    antragGegenzeichnerName: "",
  });
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    if (cfg.data) {
      setForm({
        vereinsname: cfg.data.vereinsname,
        anschriftStrasse: cfg.data.anschriftStrasse ?? "",
        anschriftPlz: cfg.data.anschriftPlz ?? "",
        anschriftOrt: cfg.data.anschriftOrt ?? "",
        anschriftLand: cfg.data.anschriftLand,
        glaeubigerId: cfg.data.glaeubigerId,
        vereinsIban: cfg.data.vereinsIban,
        vereinsBic: cfg.data.vereinsBic,
        vereinsBankname: cfg.data.vereinsBankname ?? "",
        defaultFalligkeitTag: cfg.data.defaultFalligkeitTag,
        mahngebuhr1: cfg.data.mahngebuhr1 ?? "0",
        mahngebuhr2: cfg.data.mahngebuhr2 ?? "5",
        mahngebuhr3: cfg.data.mahngebuhr3 ?? "10",
        sepaReturnFee: cfg.data.sepaReturnFee ?? "3.00",
        mahnFristTage: cfg.data.mahnFristTage ?? 14,
        beitragModus: cfg.data.beitragModus === "anteilig" ? "anteilig" : "voll",
        anteilEinheit: cfg.data.anteilEinheit === "tag" ? "tag" : "monat",
        kuendigungsfristAktiv: cfg.data.kuendigungsfristAktiv ?? false,
        kuendigungsfristTage: cfg.data.kuendigungsfristTage ?? 0,
        kuendigungZumMonatsende: cfg.data.kuendigungZumMonatsende ?? false,
        kontaktEmail: cfg.data.kontaktEmail ?? "",
        mitgliedschaftEmail: cfg.data.mitgliedschaftEmail ?? "",
        kontaktTelefon: cfg.data.kontaktTelefon ?? "",
        datenschutzUrl: cfg.data.datenschutzUrl ?? "",
        satzungUrl: cfg.data.satzungUrl ?? "",
        mandatsreferenzPrefix: cfg.data.mandatsreferenzPrefix ?? "SVUWV-",
        beitragsstaffel: cfg.data.beitragsstaffel ?? DEFAULT_STAFFEL,
        antragBenachrichtigungAktiv: cfg.data.antragBenachrichtigungAktiv ?? true,
        antragVorstandEmail: cfg.data.antragVorstandEmail ?? "",
        antragGegenzeichnungBild: cfg.data.antragGegenzeichnungBild ?? "",
        antragGegenzeichnerName: cfg.data.antragGegenzeichnerName ?? "",
      });
    }
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () =>
      orpc.organization.update({
        vereinsname: form.vereinsname,
        anschriftStrasse: form.anschriftStrasse || null,
        anschriftPlz: form.anschriftPlz || null,
        anschriftOrt: form.anschriftOrt || null,
        anschriftLand: form.anschriftLand,
        glaeubigerId: form.glaeubigerId,
        vereinsIban: form.vereinsIban,
        vereinsBic: form.vereinsBic,
        vereinsBankname: form.vereinsBankname || null,
        defaultFalligkeitTag: form.defaultFalligkeitTag,
        mahngebuhr1: normalizeMoney(form.mahngebuhr1),
        mahngebuhr2: normalizeMoney(form.mahngebuhr2),
        mahngebuhr3: normalizeMoney(form.mahngebuhr3),
        sepaReturnFee: normalizeMoney(form.sepaReturnFee),
        mahnFristTage: form.mahnFristTage,
        beitragModus: form.beitragModus,
        anteilEinheit: form.anteilEinheit,
        kuendigungsfristAktiv: form.kuendigungsfristAktiv,
        kuendigungsfristTage: form.kuendigungsfristTage,
        kuendigungZumMonatsende: form.kuendigungZumMonatsende,
        kontaktEmail: form.kontaktEmail || null,
        mitgliedschaftEmail: form.mitgliedschaftEmail || null,
        kontaktTelefon: form.kontaktTelefon || null,
        datenschutzUrl: form.datenschutzUrl || null,
        satzungUrl: form.satzungUrl || null,
        mandatsreferenzPrefix: form.mandatsreferenzPrefix || "SVUWV-",
        beitragsstaffel: {
          familie: normalizeMoney(form.beitragsstaffel.familie),
          kind: normalizeMoney(form.beitragsstaffel.kind),
          kindElternMitglied: normalizeMoney(form.beitragsstaffel.kindElternMitglied),
          jugendlich: normalizeMoney(form.beitragsstaffel.jugendlich),
          jugendlichElternMitglied: normalizeMoney(form.beitragsstaffel.jugendlichElternMitglied),
          jungerErwachsener: normalizeMoney(form.beitragsstaffel.jungerErwachsener),
          erwachsener: normalizeMoney(form.beitragsstaffel.erwachsener),
        },
        antragBenachrichtigungAktiv: form.antragBenachrichtigungAktiv,
        antragVorstandEmail: form.antragVorstandEmail || null,
        antragGegenzeichnungBild: form.antragGegenzeichnungBild || null,
        antragGegenzeichnerName: form.antragGegenzeichnerName || null,
      }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Vereinsdaten gespeichert." });
      qc.invalidateQueries({ queryKey: ["organization"] });
    },
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  // Don't render the form until the saved config has loaded. Otherwise the
  // fields show their empty defaults and an early submit would overwrite the
  // real Gläubiger-ID / IBAN / BIC with blanks.
  if (cfg.isError) {
    return (
      <QueryError
        title="Vereinsdaten konnten nicht geladen werden"
        error={cfg.error}
        onRetry={() => cfg.refetch()}
      />
    );
  }
  if (cfg.isLoading || !cfg.data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Building2 className="size-6 text-brand" /> Vereinsdaten
        </h1>
        <p className="text-sm text-muted-foreground">
          Gläubiger-Identifikation und Bankverbindung. Wird für jeden Beitragslauf in die
          pain.008-XML-Datei übernommen.
        </p>
      </div>

      {msg ? <Banner msg={msg} onDismiss={() => setMsg(null)} /> : null}

      <BrandingCard />

      <Card>
        <CardHeader>
          <CardTitle>Stammdaten und SEPA</CardTitle>
          <CardDescription>
            Diese Felder erscheinen exakt so im Lastschrift-Auftrag bei der Bank.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-5 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Vereinsname" hint="Wird als Cdtr/Nm gesendet (max. 70 Zeichen)">
              <Input
                value={form.vereinsname}
                onChange={(e) => setForm({ ...form, vereinsname: e.target.value })}
                maxLength={70}
                required
              />
            </Field>
            <Field label="Gläubiger-ID" hint="z.B. DE71ZZZ00000901082">
              <Input
                value={form.glaeubigerId}
                onChange={(e) => setForm({ ...form, glaeubigerId: e.target.value })}
                required
              />
            </Field>
            <Field label="Vereins-IBAN" hint="Konto, von dem eingezogen wird">
              <Input
                value={form.vereinsIban}
                onChange={(e) => setForm({ ...form, vereinsIban: e.target.value })}
                placeholder="DE56 7935 0101 0005 1241 85"
                required
              />
            </Field>
            <Field label="BIC" hint="SWIFT-Code der Hausbank">
              <Input
                value={form.vereinsBic}
                onChange={(e) => setForm({ ...form, vereinsBic: e.target.value.toUpperCase() })}
                placeholder="BYLADEM1KSW"
                required
              />
            </Field>
            <Field label="Bankname" hint="Optional, nur für interne Anzeige">
              <Input
                value={form.vereinsBankname}
                onChange={(e) => setForm({ ...form, vereinsBankname: e.target.value })}
                placeholder="Sparkasse Schweinfurt-Haßberge"
              />
            </Field>
            <Field
              label="Standard-Fälligkeitstag"
              hint="Vorbelegung der Fälligkeit beim neuen Beitragslauf (1-28)"
            >
              <Input
                type="number"
                min={1}
                max={28}
                value={form.defaultFalligkeitTag}
                onChange={(e) =>
                  setForm({ ...form, defaultFalligkeitTag: Number(e.target.value) || 15 })
                }
                required
              />
            </Field>
            <div className="md:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Mahnwesen
              </h3>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Mahngebühr Stufe 1 in €" hint="Wird zur Zahlungserinnerung addiert">
                  <Input
                    value={form.mahngebuhr1}
                    onChange={(e) =>
                      setForm({ ...form, mahngebuhr1: e.target.value.replace(",", ".") })
                    }
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Mahngebühr Stufe 2 in €" hint="Wird zur 1. Mahnung addiert">
                  <Input
                    value={form.mahngebuhr2}
                    onChange={(e) =>
                      setForm({ ...form, mahngebuhr2: e.target.value.replace(",", ".") })
                    }
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Mahngebühr Stufe 3 in €" hint="Wird zur 2. Mahnung addiert">
                  <Input
                    value={form.mahngebuhr3}
                    onChange={(e) =>
                      setForm({ ...form, mahngebuhr3: e.target.value.replace(",", ".") })
                    }
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Rücklastschriftgebühr in €"
                  hint="Gilt bei SEPA-Rückläufern und als SEPA-Gebühr auf dem Kulanz-Brief. 0 = keine Gebühr."
                >
                  <Input
                    value={form.sepaReturnFee}
                    onChange={(e) =>
                      setForm({ ...form, sepaReturnFee: e.target.value.replace(",", ".") })
                    }
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Zahlungsfrist in Tagen"
                  hint="Wie viele Tage nach Mahndatum die Frist ist"
                >
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={form.mahnFristTage}
                    onChange={(e) =>
                      setForm({ ...form, mahnFristTage: Number(e.target.value) || 14 })
                    }
                  />
                </Field>
              </div>
            </div>

            <div className="md:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Beitragsberechnung und Kündigung
              </h3>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field
                  label="Beitragsberechnung"
                  hint="Voll = ganzer Jahresbeitrag. Anteilig = nach Mitgliedszeitraum im Jahr."
                >
                  <Select
                    value={form.beitragModus}
                    onChange={(e) =>
                      setForm({ ...form, beitragModus: e.target.value as "voll" | "anteilig" })
                    }
                  >
                    <option value="voll">Voller Jahresbeitrag</option>
                    <option value="anteilig">Anteilig nach Mitgliedszeitraum</option>
                  </Select>
                </Field>
                {form.beitragModus === "anteilig" ? (
                  <Field
                    label="Anteilige Berechnung"
                    hint="Monatsgenau zählt angefangene Monate, taggenau zählt Tage."
                  >
                    <Select
                      value={form.anteilEinheit}
                      onChange={(e) =>
                        setForm({ ...form, anteilEinheit: e.target.value as "monat" | "tag" })
                      }
                    >
                      <option value="monat">Monatsgenau</option>
                      <option value="tag">Taggenau</option>
                    </Select>
                  </Field>
                ) : null}
                <Field
                  label="Kündigungsfrist aktiv"
                  hint="Aus = Ein- und Austritt zu jedem Datum erlaubt."
                >
                  <Select
                    value={form.kuendigungsfristAktiv ? "ja" : "nein"}
                    onChange={(e) =>
                      setForm({ ...form, kuendigungsfristAktiv: e.target.value === "ja" })
                    }
                  >
                    <option value="nein">Aus (jederzeit kündbar)</option>
                    <option value="ja">An</option>
                  </Select>
                </Field>
                {form.kuendigungsfristAktiv ? (
                  <>
                    <Field
                      label="Kündigungsfrist in Tagen"
                      hint="Frühester Austrittstermin ab heute. 0 = sofort."
                    >
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={form.kuendigungsfristTage}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            kuendigungsfristTage: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Nur zum Monatsende"
                      hint="Austritt nur am letzten Tag eines Monats zulässig."
                    >
                      <Select
                        value={form.kuendigungZumMonatsende ? "ja" : "nein"}
                        onChange={(e) =>
                          setForm({ ...form, kuendigungZumMonatsende: e.target.value === "ja" })
                        }
                      >
                        <option value="nein">Nein</option>
                        <option value="ja">Ja</option>
                      </Select>
                    </Field>
                  </>
                ) : null}
              </div>
            </div>

            <div className="md:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Anschrift
              </h3>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Straße und Hausnummer">
                  <Input
                    value={form.anschriftStrasse}
                    onChange={(e) => setForm({ ...form, anschriftStrasse: e.target.value })}
                  />
                </Field>
                <Field label="Land">
                  <Input
                    value={form.anschriftLand}
                    onChange={(e) =>
                      setForm({ ...form, anschriftLand: e.target.value.toUpperCase() })
                    }
                    maxLength={2}
                  />
                </Field>
                <Field label="PLZ">
                  <Input
                    value={form.anschriftPlz}
                    onChange={(e) => setForm({ ...form, anschriftPlz: e.target.value })}
                  />
                </Field>
                <Field label="Ort">
                  <Input
                    value={form.anschriftOrt}
                    onChange={(e) => setForm({ ...form, anschriftOrt: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <div className="md:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Kontakt und Briefangaben
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Erscheinen im Datenschutzhinweis von Briefen wie der Austrittsbestätigung. Leere
                Felder werden weggelassen.
              </p>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Kontakt E-Mail">
                  <Input
                    type="email"
                    value={form.kontaktEmail}
                    onChange={(e) => setForm({ ...form, kontaktEmail: e.target.value })}
                    placeholder="info@verein.de"
                  />
                </Field>
                <Field
                  label="Mitgliedschaft E-Mail"
                  hint="Für Kündigungen aus dem Kulanz-Brief und den Kontakt auf der Austrittsbestätigung. Leer: es wird die Kontakt E-Mail verwendet."
                >
                  <Input
                    type="email"
                    value={form.mitgliedschaftEmail}
                    onChange={(e) => setForm({ ...form, mitgliedschaftEmail: e.target.value })}
                    placeholder="mitgliedschaft@verein.de"
                  />
                </Field>
                <Field label="Kontakt Telefon">
                  <Input
                    value={form.kontaktTelefon}
                    onChange={(e) => setForm({ ...form, kontaktTelefon: e.target.value })}
                    placeholder="09729/432"
                  />
                </Field>
                <Field label="Datenschutzerklärung URL">
                  <Input
                    value={form.datenschutzUrl}
                    onChange={(e) => setForm({ ...form, datenschutzUrl: e.target.value })}
                    placeholder="https://verein.de/datenschutz"
                  />
                </Field>
                <Field label="Vereinssatzung URL">
                  <Input
                    value={form.satzungUrl}
                    onChange={(e) => setForm({ ...form, satzungUrl: e.target.value })}
                    placeholder="https://verein.de/satzung"
                  />
                </Field>
              </div>
            </div>

            <div className="md:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Aufnahmeantrag (Online)
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Steuert das öffentliche Antragsformular unter /antrag: Mandatsreferenz,
                Jahresbeiträge je Alterskategorie und die Benachrichtigung über neue Anträge.
              </p>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field
                  label="Mandatsreferenz-Präfix"
                  hint="Daraus wird die Mandatsreferenz gebaut, z. B. SVU1945-"
                >
                  <Input
                    value={form.mandatsreferenzPrefix}
                    onChange={(e) => setForm({ ...form, mandatsreferenzPrefix: e.target.value })}
                    placeholder="SVU1945-"
                  />
                </Field>
                <Field
                  label="Benachrichtigung an den Verein"
                  hint="Bei jedem neuen Online-Antrag eine E-Mail an den Verein senden."
                >
                  <Select
                    value={form.antragBenachrichtigungAktiv ? "ja" : "nein"}
                    onChange={(e) =>
                      setForm({ ...form, antragBenachrichtigungAktiv: e.target.value === "ja" })
                    }
                  >
                    <option value="ja">An</option>
                    <option value="nein">Aus</option>
                  </Select>
                </Field>
                <Field
                  label="Vereins-E-Mail für Anträge"
                  hint="Empfänger der Antrags-Benachrichtigung. Leer: es wird die Mitgliedschaft-E-Mail verwendet."
                >
                  <Input
                    type="email"
                    value={form.antragVorstandEmail}
                    onChange={(e) => setForm({ ...form, antragVorstandEmail: e.target.value })}
                    placeholder="mitgliedschaft@verein.de"
                  />
                </Field>
              </div>
              <h4 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Jahresbeiträge je Kategorie in €
              </h4>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <StaffelField
                  label="Familie"
                  value={form.beitragsstaffel.familie}
                  onChange={(val) =>
                    setForm({ ...form, beitragsstaffel: { ...form.beitragsstaffel, familie: val } })
                  }
                />
                <StaffelField
                  label="Erwachsene"
                  value={form.beitragsstaffel.erwachsener}
                  onChange={(val) =>
                    setForm({
                      ...form,
                      beitragsstaffel: { ...form.beitragsstaffel, erwachsener: val },
                    })
                  }
                />
                <StaffelField
                  label="Junge Erwachsene (bis 25)"
                  value={form.beitragsstaffel.jungerErwachsener}
                  onChange={(val) =>
                    setForm({
                      ...form,
                      beitragsstaffel: { ...form.beitragsstaffel, jungerErwachsener: val },
                    })
                  }
                />
                <div />
                <StaffelField
                  label="Jugendliche (bis 18), kein Elternteil Mitglied"
                  value={form.beitragsstaffel.jugendlich}
                  onChange={(val) =>
                    setForm({
                      ...form,
                      beitragsstaffel: { ...form.beitragsstaffel, jugendlich: val },
                    })
                  }
                />
                <StaffelField
                  label="Jugendliche (bis 18), 1 Elternteil Mitglied"
                  value={form.beitragsstaffel.jugendlichElternMitglied}
                  onChange={(val) =>
                    setForm({
                      ...form,
                      beitragsstaffel: {
                        ...form.beitragsstaffel,
                        jugendlichElternMitglied: val,
                      },
                    })
                  }
                />
                <StaffelField
                  label="Kinder (bis 14), kein Elternteil Mitglied"
                  value={form.beitragsstaffel.kind}
                  onChange={(val) =>
                    setForm({ ...form, beitragsstaffel: { ...form.beitragsstaffel, kind: val } })
                  }
                />
                <StaffelField
                  label="Kinder (bis 14), 1 Elternteil Mitglied"
                  value={form.beitragsstaffel.kindElternMitglied}
                  onChange={(val) =>
                    setForm({
                      ...form,
                      beitragsstaffel: { ...form.beitragsstaffel, kindElternMitglied: val },
                    })
                  }
                />
              </div>

              <h4 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Gegenzeichnung des Vorstands
              </h4>
              <p className="mb-3 text-xs text-muted-foreground">
                Wird beim Genehmigen in die Beitrittserklärung eingebettet. Ohne Bild zeigt das
                genehmigte PDF nur die Unterschrift des Antragstellers.
              </p>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field
                  label="Name unter der Unterschrift"
                  hint="z. B. Max Mustermann, 1. Vorsitzender"
                >
                  <Input
                    value={form.antragGegenzeichnerName}
                    onChange={(e) => setForm({ ...form, antragGegenzeichnerName: e.target.value })}
                    placeholder="Max Mustermann, 1. Vorsitzender"
                  />
                </Field>
                <Field
                  label="Unterschriftsbild (PNG oder JPEG, max. 500 KB)"
                  hint="Am besten ein freigestelltes Bild der Unterschrift auf weißem Grund."
                >
                  <div className="flex flex-col gap-2">
                    {form.antragGegenzeichnungBild ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={form.antragGegenzeichnungBild}
                          alt="Vorschau der Gegenzeichnung"
                          className="h-12 rounded border border-border bg-white object-contain px-2"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ ...form, antragGegenzeichnungBild: "" })}
                        >
                          <Trash2 className="size-4" />
                          Entfernen
                        </Button>
                      </div>
                    ) : null}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 500_000) {
                          setMsg({ kind: "error", text: "Bild zu groß (max. 500 KB)." });
                          e.target.value = "";
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () =>
                          setForm((f) => ({
                            ...f,
                            antragGegenzeichnungBild: String(reader.result),
                          }));
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                </Field>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Speichern
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const DEFAULT_BRAND = "#dc2626";

/**
 * White-Label: Anzeigename, Logo und Markenfarbe für die ganze Oberfläche.
 * Eigene Karte und eigener Speicherpfad (updateBranding), unabhängig von den
 * SEPA-Pflichtfeldern. Nach dem Speichern wird der Router neu validiert, damit
 * Farbe, Logo und Name sofort greifen, ohne Reload.
 */
function BrandingCard() {
  const router = useRouter();
  const qc = useQueryClient();
  const live = useBranding();
  const cfg = useQuery({
    queryKey: ["organization.getForEdit"],
    queryFn: () => orpc.organization.getForEdit(),
  });

  const [anzeigename, setAnzeigename] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!cfg.data) return;
    setAnzeigename(cfg.data.anzeigename ?? "");
    setLogo(cfg.data.logo ?? "");
    setColor(cfg.data.primaryColor ?? "");
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () =>
      orpc.organization.updateBranding({
        anzeigename: anzeigename?.trim() || null,
        logo: logo || null,
        primaryColor: color || null,
      }),
    onSuccess: async () => {
      toast.success("Branding gespeichert");
      await qc.invalidateQueries({ queryKey: ["organization.getForEdit"] });
      await router.invalidate(); // re-runs the root loader -> color/logo/name apply now
    },
    onError: (e: Error) => toast.error("Speichern fehlgeschlagen", { description: e.message }),
  });

  if (cfg.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Wird geladen…
        </CardContent>
      </Card>
    );
  }
  if (!cfg.data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Bitte zuerst die Stammdaten unten speichern, dann lässt sich das Branding anpassen.
        </CardContent>
      </Card>
    );
  }

  const previewLogo = logo || live.logoSrc;
  const previewColor = color || DEFAULT_BRAND;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-5 text-brand" /> Erscheinungsbild
        </CardTitle>
        <CardDescription>
          Anzeigename, Logo und Markenfarbe für die gesamte Oberfläche, Anmeldung und das
          Mitgliederportal. Leer lassen für das Standard-Aussehen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Anzeigename" hint="Kurzer Name in Kopfzeile, Anmeldung und Browser-Tab.">
            <Input
              value={anzeigename ?? ""}
              onChange={(e) => setAnzeigename(e.target.value)}
              placeholder="z. B. SV Untereuerheim"
            />
          </Field>

          <Field label="Markenfarbe" hint="Färbt Schaltflächen und Akzente. Leer = Standardrot.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Markenfarbe wählen"
                value={/^#[0-9a-fA-F]{6}$/.test(color ?? "") ? (color as string) : DEFAULT_BRAND}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded-lg border border-input bg-card"
              />
              <Input
                value={color ?? ""}
                onChange={(e) => setColor(e.target.value)}
                placeholder={DEFAULT_BRAND}
                className="font-mono"
              />
              {color ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setColor("")}>
                  Zurücksetzen
                </Button>
              ) : null}
            </div>
          </Field>

          <Field
            label="Logo (PNG, SVG oder JPEG, max. 500 KB)"
            hint="Erscheint überall in der App. Am besten freigestellt auf transparentem Grund."
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                  <img src={previewLogo} alt="Logo-Vorschau" className="size-10 object-contain" />
                </div>
                {logo ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLogo("")}>
                    <Trash2 className="size-4" /> Entfernen
                  </Button>
                ) : null}
              </div>
              <input
                type="file"
                accept="image/png,image/svg+xml,image/jpeg"
                className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500_000) {
                    toast.error("Logo zu groß (max. 500 KB).");
                    e.target.value = "";
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setLogo(String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
            </div>
          </Field>

          <Field label="Vorschau">
            <div
              className="flex items-center gap-3 rounded-lg border border-border p-3"
              style={{ backgroundColor: previewColor }}
            >
              <div className="flex size-9 items-center justify-center overflow-hidden rounded-lg bg-white">
                <img src={previewLogo} alt="" className="size-7 object-contain" />
              </div>
              <span className="text-sm font-semibold text-white">
                {anzeigename?.trim() || "Vereinsverwaltung"}
              </span>
            </div>
          </Field>
        </div>

        <div className="mt-5 flex justify-end border-t border-border pt-5">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Erscheinungsbild speichern
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`flex h-10 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm text-foreground shadow-soft transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </select>
  );
}

function StaffelField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <Field label={label}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(",", "."))}
        inputMode="decimal"
        placeholder="0,00"
      />
    </Field>
  );
}

function normalizeMoney(raw: string): string {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return "0";
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2);
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // Wrap the control inside the <label> so clicking the label focuses the
  // field and screen readers announce it — without threading an id through
  // every call site.
  return (
    <Label className="flex flex-col gap-1.5">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </Label>
  );
}

function Banner({ msg, onDismiss }: { msg: Msg; onDismiss: () => void }) {
  const styles =
    msg.kind === "ok"
      ? "border-success/30 bg-success/10"
      : "border-destructive/30 bg-destructive/10";
  const Icon = msg.kind === "ok" ? CheckCircle2 : XCircle;
  const iconColor = msg.kind === "ok" ? "text-success" : "text-destructive";
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm shadow-soft ${styles}`}
      role="status"
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconColor}`} />
      <span className="flex-1 break-words">{msg.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        schließen
      </button>
    </div>
  );
}
