import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, CheckCircle2, Loader2, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
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
      }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Vereinsdaten gespeichert." });
      qc.invalidateQueries({ queryKey: ["organization"] });
    },
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
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
