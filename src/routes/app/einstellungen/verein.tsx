import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, CheckCircle2, Loader2, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/verein")({
  component: VereinsdatenPage,
});

type Msg = { kind: "ok" | "error"; text: string };

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
    sepaReturnFee: "0",
    mahnFristTage: 14,
    beitragModus: "voll" as "voll" | "anteilig",
    anteilEinheit: "monat" as "monat" | "tag",
    kuendigungsfristAktiv: false,
    kuendigungsfristTage: 0,
    kuendigungZumMonatsende: false,
    kontaktEmail: "",
    kontaktTelefon: "",
    datenschutzUrl: "",
    satzungUrl: "",
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
        sepaReturnFee: cfg.data.sepaReturnFee ?? "0",
        mahnFristTage: cfg.data.mahnFristTage ?? 14,
        beitragModus: cfg.data.beitragModus === "anteilig" ? "anteilig" : "voll",
        anteilEinheit: cfg.data.anteilEinheit === "tag" ? "tag" : "monat",
        kuendigungsfristAktiv: cfg.data.kuendigungsfristAktiv ?? false,
        kuendigungsfristTage: cfg.data.kuendigungsfristTage ?? 0,
        kuendigungZumMonatsende: cfg.data.kuendigungZumMonatsende ?? false,
        kontaktEmail: cfg.data.kontaktEmail ?? "",
        kontaktTelefon: cfg.data.kontaktTelefon ?? "",
        datenschutzUrl: cfg.data.datenschutzUrl ?? "",
        satzungUrl: cfg.data.satzungUrl ?? "",
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
        kontaktTelefon: form.kontaktTelefon || null,
        datenschutzUrl: form.datenschutzUrl || null,
        satzungUrl: form.satzungUrl || null,
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
                  hint="Standardwert, wenn ein SEPA-Rückläufer erfasst wird"
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
