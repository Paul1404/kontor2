import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Download,
  FileText,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UserSquare,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { Switch } from "~/components/ui/switch";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { triggerDocumentDownload } from "~/lib/download";
import { formatDate, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type MemberLike = Record<string, unknown>;
type Abteilung = { name: string | null; austrittsdatum?: string | Date | null };

/** Relationship row as returned by `members.get` (target fields prefixed `to`). */
type Beziehung = {
  id: string;
  beziehung: string | null;
  istVertreter: boolean;
  toMemberId: string | null;
  toAdrNr: number;
  fallbackName: string | null;
  toMitglnr: string | null;
  toVorname: string | null;
  toNachname: string | null;
  toAnrede: string | null;
  toStrasse: string | null;
  toHausnummer: string | null;
  toPlz: string | null;
  toOrt: string | null;
  toGeburtsdatum: string | Date | null;
};

type FamilyRow = {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  mitgliedsnummer: string;
};

type Empfaenger = {
  anrede: string;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
};

const EMPTY_EMPF: Empfaenger = {
  anrede: "",
  vorname: "",
  nachname: "",
  strasse: "",
  plz: "",
  ort: "",
};

// A relationship that typically receives the letter instead of the member.
const PAYER_RE = /zahler|vertret|eltern|mutter|vater|vormund|gesetz|betreu/i;
// A relationship that belongs on a family membership letter.
const FAMILY_RE = /famil|kind|sohn|tochter|ehe|partner|gatt|geschwister|bruder|schwester/i;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Coerce a date field (ISO string, Date or null) into a yyyy-mm-dd input value. */
function toDateInput(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** Best-effort split of a single "Vorname Nachname" string into two fields. */
function splitName(full: string): { vorname: string; nachname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { vorname: "", nachname: "" };
  if (parts.length === 1) return { vorname: "", nachname: parts[0]! };
  return { vorname: parts.slice(0, -1).join(" "), nachname: parts.at(-1)! };
}

function bezDisplayName(b: Beziehung): string {
  return (
    [b.toVorname, b.toNachname].filter(Boolean).join(" ") || b.fallbackName || `AdrNr ${b.toAdrNr}`
  );
}

/** Build a recipient block from a relationship target. */
function empfFromBeziehung(b: Beziehung): Empfaenger {
  let vorname = str(b.toVorname);
  let nachname = str(b.toNachname);
  if (!vorname && !nachname && b.fallbackName) {
    const s = splitName(b.fallbackName);
    vorname = s.vorname;
    nachname = s.nachname;
  }
  const strasse = [str(b.toStrasse), str(b.toHausnummer)].filter(Boolean).join(" ");
  return {
    anrede: str(b.toAnrede),
    vorname,
    nachname,
    strasse,
    plz: str(b.toPlz),
    ort: str(b.toOrt),
  };
}

function familyRowFromBeziehung(b: Beziehung): FamilyRow {
  let vorname = str(b.toVorname);
  let nachname = str(b.toNachname);
  if (!vorname && !nachname && b.fallbackName) {
    const s = splitName(b.fallbackName);
    vorname = s.vorname;
    nachname = s.nachname;
  }
  return {
    vorname,
    nachname,
    geburtsdatum: toDateInput(b.toGeburtsdatum),
    mitgliedsnummer: str(b.toMitglnr),
  };
}

export function AustrittsbestaetigungCard({
  memberId,
  member,
  abteilungen,
  beziehungen,
  canEdit,
}: {
  memberId: string;
  member: MemberLike;
  abteilungen: Abteilung[];
  beziehungen?: Beziehung[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const listKey = ["cancellations.listForMember", memberId];
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => orpc.cancellations.listForMember({ memberId }),
  });
  const relations = beziehungen ?? [];

  const [open, setOpen] = useState(false);

  // Department options, deduped by name. A name counts as active if any of
  // its memberships is still open (no Austrittsdatum).
  const abteilungOptions = useMemo(() => {
    const byName = new Map<string, { name: string; active: boolean; austrittsdatum: string }>();
    for (const a of abteilungen) {
      const name = (a.name ?? "").trim();
      if (!name) continue;
      const active = !a.austrittsdatum;
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, {
          name,
          active,
          austrittsdatum: active ? "" : toDateInput(a.austrittsdatum),
        });
      } else if (active) {
        existing.active = true;
        existing.austrittsdatum = "";
      }
    }
    return [...byName.values()];
  }, [abteilungen]);

  // Recipient candidates from relationships: payer/representative first.
  const empfCandidates = useMemo(() => {
    const score = (b: Beziehung) =>
      (b.istVertreter ? 2 : 0) + (b.beziehung && PAYER_RE.test(b.beziehung) ? 1 : 0);
    return [...relations].sort((a, b) => score(b) - score(a));
  }, [relations]);

  const familyCandidates = useMemo(
    () => relations.filter((b) => b.beziehung && FAMILY_RE.test(b.beziehung)),
    [relations],
  );

  const [austrittDatum, setAustrittDatum] = useState(() => toDateInput(member.austritt));
  const [selectedAbt, setSelectedAbt] = useState<Set<string>>(
    () => new Set(abteilungOptions.filter((o) => o.active).map((o) => o.name)),
  );
  const [abtFreitext, setAbtFreitext] = useState(false);
  const [abtManual, setAbtManual] = useState("");

  const [abweichend, setAbweichend] = useState(false);
  const [empf, setEmpf] = useState<Empfaenger>(EMPTY_EMPF);
  const [pickedBezId, setPickedBezId] = useState<string | null>(null);
  const [isFamily, setIsFamily] = useState(false);
  const [family, setFamily] = useState<FamilyRow[]>([]);

  const abteilungValue = abtFreitext
    ? abtManual.trim()
    : abteilungOptions
        .filter((o) => selectedAbt.has(o.name))
        .map((o) => o.name)
        .join(", ");

  function resetForm() {
    setAustrittDatum(toDateInput(member.austritt));
    setSelectedAbt(new Set(abteilungOptions.filter((o) => o.active).map((o) => o.name)));
    setAbtFreitext(false);
    setAbtManual("");
    setAbweichend(false);
    setEmpf(EMPTY_EMPF);
    setPickedBezId(null);
    setIsFamily(false);
    setFamily([]);
  }

  function toggleAbt(name: string) {
    setSelectedAbt((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function prefillEmpfaengerFromVertreter() {
    const name = splitName(str(member.vertreterName));
    const haus = str(member.vertreterHausnummer);
    const strasse = [str(member.vertreterStrasse), haus].filter(Boolean).join(" ");
    setPickedBezId(null);
    setEmpf({
      anrede: str(member.vertreterAnrede),
      vorname: name.vorname,
      nachname: name.nachname,
      strasse,
      plz: str(member.vertreterPlz),
      ort: str(member.vertreterOrt),
    });
  }

  const hasVertreterFields = Boolean(
    str(member.vertreterName) || str(member.vertreterStrasse) || str(member.vertreterOrt),
  );

  function pickEmpfaenger(b: Beziehung) {
    setPickedBezId(b.id);
    setEmpf(empfFromBeziehung(b));
  }

  function addFamilyFromBeziehung(b: Beziehung) {
    const row = familyRowFromBeziehung(b);
    setFamily((prev) => {
      const dup = prev.some(
        (r) =>
          (row.mitgliedsnummer && r.mitgliedsnummer === row.mitgliedsnummer) ||
          (r.vorname === row.vorname && r.nachname === row.nachname),
      );
      return dup ? prev : [...prev, row];
    });
  }

  const generate = useMutation({
    mutationFn: () =>
      orpc.cancellations.generate({
        memberId,
        austrittDatum,
        abteilung: abteilungValue || null,
        empfaengerAbweichend: abweichend,
        empfaenger: abweichend ? empf : null,
        isFamily,
        familienmitglieder: isFamily
          ? family
              .filter((f) => f.vorname.trim() || f.nachname.trim())
              .map((f) => ({
                vorname: f.vorname.trim(),
                nachname: f.nachname.trim(),
                geburtsdatum: f.geburtsdatum.trim() || null,
                mitgliedsnummer: f.mitgliedsnummer.trim() || null,
              }))
          : [],
      }),
    onSuccess: async (res) => {
      triggerDocumentDownload(res);
      toast.success("Austrittsbestätigung erstellt");
      setOpen(false);
      resetForm();
      await qc.invalidateQueries({ queryKey: listKey });
    },
    onError: (err) =>
      toast.error("Erstellung fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const download = useMutation({
    mutationFn: (id: string) => orpc.cancellations.download({ id }),
    onSuccess: (res) => {
      window.open(res.url, "_blank", "noopener");
    },
    onError: (err) =>
      toast.error("Download fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5 text-muted-foreground" />
          Austrittsbestätigung
        </CardTitle>
        {canEdit && !open ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Erstellen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open ? (
          <form
            className="flex flex-col gap-5 rounded-lg border border-border bg-muted/30 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              generate.mutate();
            }}
          >
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="austritt-datum">Austritt zum</Label>
                <DateField
                  id="austritt-datum"
                  required
                  value={austrittDatum}
                  onChange={(v) => setAustrittDatum(v)}
                  className="w-44"
                />
              </div>
            </div>

            {/* Abteilungen: chips built from the member's actual departments. */}
            <fieldset className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="m-0">Abteilung(en)</Label>
                {abteilungOptions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!abtFreitext) setAbtManual(abteilungValue);
                      setAbtFreitext((v) => !v);
                    }}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {abtFreitext ? "Aus Abteilungen wählen" : "Freitext anpassen"}
                  </button>
                ) : null}
              </div>

              {abtFreitext || abteilungOptions.length === 0 ? (
                <Input
                  value={abtFreitext ? abtManual : abteilungValue}
                  onChange={(e) => {
                    setAbtFreitext(true);
                    setAbtManual(e.target.value);
                  }}
                  placeholder="optional, z. B. Fußball, Turnen"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {abteilungOptions.map((o) => {
                    const on = selectedAbt.has(o.name);
                    return (
                      <button
                        key={o.name}
                        type="button"
                        onClick={() => toggleAbt(o.name)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                          on
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 items-center justify-center rounded-full border",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {on ? <Check className="size-3" /> : null}
                        </span>
                        {o.name}
                        {!o.active ? (
                          <span className="text-xs text-muted-foreground">
                            ausgetreten{o.austrittsdatum ? ` ${o.austrittsdatum}` : ""}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {/* Recipient. */}
            <div className="flex flex-col gap-3">
              <Switch
                id="austritt-abweichend"
                label="Abweichender Empfänger"
                description="Brief geht an eine andere Person (z. B. Eltern oder Zahler)."
                checked={abweichend}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAbweichend(on);
                  if (on && !empf.nachname && !empf.vorname) {
                    if (empfCandidates.length > 0) pickEmpfaenger(empfCandidates[0]!);
                    else if (hasVertreterFields) prefillEmpfaengerFromVertreter();
                  }
                }}
              />

              {abweichend ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
                  {empfCandidates.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Aus Beziehungen übernehmen
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {empfCandidates.map((b) => {
                          const picked = pickedBezId === b.id;
                          const payer =
                            b.istVertreter || (b.beziehung && PAYER_RE.test(b.beziehung));
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => pickEmpfaenger(b)}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                                picked
                                  ? "border-primary/40 bg-primary/10 text-foreground"
                                  : "border-border bg-card text-muted-foreground hover:text-foreground",
                              )}
                              title={b.beziehung ?? undefined}
                            >
                              {b.istVertreter ? (
                                <ShieldCheck className="size-3.5 text-primary" />
                              ) : (
                                <UserSquare className="size-3.5" />
                              )}
                              {bezDisplayName(b)}
                              {payer && b.beziehung ? (
                                <span className="text-xs text-muted-foreground">{b.beziehung}</span>
                              ) : null}
                            </button>
                          );
                        })}
                        {hasVertreterFields ? (
                          <button
                            type="button"
                            onClick={prefillEmpfaengerFromVertreter}
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
                          >
                            Gespeicherte Vertretung
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="empf-anrede">Anrede</Label>
                      <select
                        id="empf-anrede"
                        value={empf.anrede}
                        onChange={(e) => setEmpf({ ...empf, anrede: e.target.value })}
                        className="h-10 w-40 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      >
                        <option value="">Keine Angabe</option>
                        <option value="Herr">Herr</option>
                        <option value="Frau">Frau</option>
                      </select>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="empf-vorname">Vorname</Label>
                      <Input
                        id="empf-vorname"
                        value={empf.vorname}
                        onChange={(e) => setEmpf({ ...empf, vorname: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="empf-nachname">Nachname</Label>
                      <Input
                        id="empf-nachname"
                        value={empf.nachname}
                        onChange={(e) => setEmpf({ ...empf, nachname: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="empf-strasse">Straße</Label>
                      <Input
                        id="empf-strasse"
                        value={empf.strasse}
                        onChange={(e) => setEmpf({ ...empf, strasse: e.target.value })}
                      />
                    </div>
                    <div className="flex w-28 flex-col gap-1.5">
                      <Label htmlFor="empf-plz">PLZ</Label>
                      <Input
                        id="empf-plz"
                        value={empf.plz}
                        onChange={(e) => setEmpf({ ...empf, plz: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="empf-ort">Ort</Label>
                      <Input
                        id="empf-ort"
                        value={empf.ort}
                        onChange={(e) => setEmpf({ ...empf, ort: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Family. */}
            <div className="flex flex-col gap-3">
              <Switch
                id="austritt-familie"
                label="Familienmitgliedschaft"
                description="Weitere Mitglieder auf einem Schreiben zusammenfassen."
                checked={isFamily}
                onChange={(e) => {
                  const on = e.target.checked;
                  setIsFamily(on);
                  if (on && family.length === 0 && familyCandidates.length > 0) {
                    setFamily(familyCandidates.map(familyRowFromBeziehung));
                  }
                }}
              />

              {isFamily ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                  {familyCandidates.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Users className="size-3.5" /> Aus Beziehungen
                      </span>
                      {familyCandidates.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => addFamilyFromBeziehung(b)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="size-3" /> {bezDisplayName(b)}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {family.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Noch keine Familienmitglieder hinzugefügt.
                    </p>
                  ) : null}
                  {family.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no stable id.
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-1 flex-col gap-1.5">
                        <Label htmlFor={`fam-vorname-${i}`}>Vorname</Label>
                        <Input
                          id={`fam-vorname-${i}`}
                          value={row.vorname}
                          onChange={(e) =>
                            setFamily(
                              family.map((r, j) =>
                                j === i ? { ...r, vorname: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5">
                        <Label htmlFor={`fam-nachname-${i}`}>Nachname</Label>
                        <Input
                          id={`fam-nachname-${i}`}
                          value={row.nachname}
                          onChange={(e) =>
                            setFamily(
                              family.map((r, j) =>
                                j === i ? { ...r, nachname: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="flex w-40 flex-col gap-1.5">
                        <Label htmlFor={`fam-geb-${i}`}>Geburtsdatum</Label>
                        <DateField
                          id={`fam-geb-${i}`}
                          value={row.geburtsdatum}
                          onChange={(v) =>
                            setFamily(
                              family.map((r, j) => (j === i ? { ...r, geburtsdatum: v } : r)),
                            )
                          }
                        />
                      </div>
                      <div className="flex w-36 flex-col gap-1.5">
                        <Label htmlFor={`fam-nr-${i}`}>Mitgliedsnr.</Label>
                        <Input
                          id={`fam-nr-${i}`}
                          value={row.mitgliedsnummer}
                          onChange={(e) =>
                            setFamily(
                              family.map((r, j) =>
                                j === i ? { ...r, mitgliedsnummer: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Entfernen"
                        onClick={() => setFamily(family.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setFamily([
                          ...family,
                          { vorname: "", nachname: "", geburtsdatum: "", mitgliedsnummer: "" },
                        ])
                      }
                    >
                      <Plus className="size-4" /> Familienmitglied
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={generate.isPending}
              >
                <X className="size-4" /> Abbrechen
              </Button>
              <Button type="submit" disabled={generate.isPending}>
                {generate.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                PDF erstellen
              </Button>
            </div>
          </form>
        ) : null}

        {list.isError ? (
          <QueryError onRetry={() => list.refetch()} error={list.error} />
        ) : list.data && list.data.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.data.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {row.displayName}
                    {row.isFamily ? (
                      <Badge variant="secondary" className="gap-1">
                        <Users className="size-3" /> Familie
                      </Badge>
                    ) : null}
                    {row.empfaengerAbweichend ? (
                      <Badge variant="outline">Abw. Empfänger</Badge>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.docRef ? `${row.docRef} · ` : ""}Austritt zum{" "}
                    {formatDate(row.austrittDatum)} · erstellt {formatDateTime(row.createdAt)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => download.mutate(row.id)}
                  disabled={download.isPending}
                >
                  <Download className="size-4" /> Öffnen
                </Button>
              </li>
            ))}
          </ul>
        ) : !open ? (
          <p className="text-sm text-muted-foreground">Noch keine Austrittsbestätigung erstellt.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
