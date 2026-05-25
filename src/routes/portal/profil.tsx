import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
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
  { key: "landname", label: "Land" },
  { key: "telefon1", label: "Telefon" },
  { key: "telefon2", label: "Mobil" },
  { key: "eMailName", label: "E-Mail" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

function PortalProfilePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
    landname: "",
    telefon1: "",
    telefon2: "",
    eMailName: "",
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
      landname: m.landname ?? "",
      telefon1: m.telefon1 ?? "",
      telefon2: m.telefon2 ?? "",
      eMailName: m.eMailName ?? "",
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
      toast.success(`Vorschlag eingereicht (${r.fieldCount} Feld(er)).`, {
        description: "Der Vorstand prüft die Änderungen.",
      });
      qc.invalidateQueries({ queryKey: ["portal.me"] });
      navigate({ to: "/portal" });
    },
    onError: (e: Error) =>
      toast.error("Konnte nicht eingereicht werden", { description: e.message }),
  });

  if (me.isLoading) {
    return <p className="text-sm text-muted-foreground">Wird geladen...</p>;
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
              <Input
                id={f.key}
                value={form[f.key]}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
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
        <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
          <Save className="size-4" /> Vorschlag absenden
        </Button>
      </div>
    </div>
  );
}
