import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  buildPatch,
  EMPTY_STAMM,
  MemberStammdatenForm,
  type StammdatenValues,
} from "~/components/forms/MemberStammdatenForm";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/cn";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/mitglieder/neu")({
  component: NewMemberPage,
});

type Step = "stamm" | "verein";

function NewMemberPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("stamm");
  const [mitgliedsnummer, setMitglnr] = useState("");
  const [stamm, setStamm] = useState<StammdatenValues>(EMPTY_STAMM);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 2 state.
  const [selectedAbt, setSelectedAbt] = useState<string[]>([]);
  const [beitragOn, setBeitragOn] = useState(false);
  const [art, setArt] = useState<number | "">("");
  const [betrag, setBetrag] = useState("");
  const [sepaOn, setSepaOn] = useState(false);

  const abteilungen = useQuery({
    queryKey: ["members.abteilungenList"],
    queryFn: () => orpc.members.abteilungenList(),
  });
  const feeTypes = useQuery({
    queryKey: ["feeTypes.list"],
    queryFn: () => orpc.feeTypes.list(),
  });

  const mut = useMutation({
    mutationFn: () => {
      const eintritt = stamm.eintritt.trim() || null;
      const beitragArt = beitragOn && art !== "" ? Number(art) : null;
      const beitragArtName =
        beitragArt != null
          ? (feeTypes.data?.find((f) => f.art === beitragArt)?.bezeichnung ?? null)
          : null;
      return orpc.members.onboard({
        mitgliedsnummer: mitgliedsnummer.trim().length > 0 ? mitgliedsnummer.trim() : null,
        patch: buildPatch(stamm, "") as never,
        abteilungen: selectedAbt.map((id) => ({ abteilungId: id, eintrittsdatum: eintritt })),
        contract:
          beitragArt != null
            ? {
                art: beitragArt,
                artName: beitragArtName,
                betrag: betrag.trim() || null,
                vertragBegin: eintritt,
              }
            : null,
        sepa: sepaOn ? {} : null,
      });
    },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["members.list"] });
      navigate({
        to: "/app/mitglieder/$mitgliedsnummer",
        params: { mitgliedsnummer: result.mitgliedsnummer ?? String(result.adrNr) },
      });
    },
    onError: (e: unknown) => {
      setErrorMessage(e instanceof Error ? e.message : "Anlage fehlgeschlagen.");
    },
  });

  function toggleAbt(id: string) {
    setSelectedAbt((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/app/mitglieder"
          search={() => ({}) as never}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zur Liste
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Neues Mitglied</h1>
        <p className="text-sm text-muted-foreground">
          Mitgliedsnummer und AdrNr werden automatisch vergeben, wenn leer gelassen.
        </p>
      </div>

      <StepIndicator step={step} />

      {step === "stamm" ? (
        <MemberStammdatenForm
          initial={stamm}
          submitting={false}
          submitLabel="Weiter"
          mitglnrInput={{ value: mitgliedsnummer, onChange: setMitglnr }}
          onCancel={() => navigate({ to: "/app/mitglieder", search: () => ({}) as never })}
          onSubmit={(values) => {
            setStamm(values);
            setStep("verein");
          }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Abteilungen</CardTitle>
            </CardHeader>
            <CardContent>
              {abteilungen.data && abteilungen.data.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {abteilungen.data.map((a) => {
                    const active = selectedAbt.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAbt(a.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-ring/40",
                        )}
                      >
                        {active ? <Check className="size-3.5 text-primary" /> : null}
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Abteilungen vorhanden.</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Eintrittsdatum entspricht dem Vereinseintritt aus Schritt 1.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Beitrag</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Switch
                id="onboard-beitrag"
                checked={beitragOn}
                onChange={(e) => setBeitragOn(e.target.checked)}
                label="Beitrag/Vertrag anlegen"
                description="Optional. Kann auch später hinzugefügt werden."
              />
              {beitragOn ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="onboard-art">Beitragsart</Label>
                    <select
                      id="onboard-art"
                      value={art}
                      onChange={(e) => setArt(e.target.value === "" ? "" : Number(e.target.value))}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Bitte wählen</option>
                      {feeTypes.data?.map((f) => (
                        <option key={f.art} value={f.art}>
                          {f.bezeichnung ?? `Art ${f.art}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="onboard-betrag">Betrag (EUR)</Label>
                    <Input
                      id="onboard-betrag"
                      inputMode="decimal"
                      placeholder="z. B. 60,00"
                      value={betrag}
                      onChange={(e) => setBetrag(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SEPA-Lastschrift</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Switch
                id="onboard-sepa"
                checked={sepaOn}
                onChange={(e) => setSepaOn(e.target.checked)}
                label="SEPA-Mandat anlegen"
                description="Legt ein Mandat an. Die Bankverbindung stammt aus den Stammdaten in Schritt 1."
              />
            </CardContent>
          </Card>

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("stamm")}
              disabled={mut.isPending}
            >
              Zurück
            </Button>
            <Button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                mut.mutate();
              }}
              disabled={mut.isPending}
            >
              {mut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Mitglied anlegen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "stamm", label: "Stammdaten" },
    { key: "verein", label: "Vereinsdaten" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-3">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                i <= activeIndex
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i < activeIndex ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                i === activeIndex ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 ? <div className="h-px w-8 bg-border" /> : null}
        </div>
      ))}
    </div>
  );
}
