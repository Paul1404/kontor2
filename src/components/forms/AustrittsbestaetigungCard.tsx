import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { Switch } from "~/components/ui/switch";
import { toast } from "~/components/ui/toaster";
import { triggerDownloadBase64 } from "~/lib/download";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type MemberLike = Record<string, unknown>;
type Abteilung = { name: string | null; austrittsdatum?: string | Date | null };

type FamilyRow = {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  mitgliedsnummer: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Coerce a member date field (ISO string or null) into a yyyy-mm-dd input value. */
function toDateInput(v: unknown): string {
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

export function AustrittsbestaetigungCard({
  memberId,
  member,
  abteilungen,
  canEdit,
}: {
  memberId: string;
  member: MemberLike;
  abteilungen: Abteilung[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const listKey = ["cancellations.listForMember", memberId];
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => orpc.cancellations.listForMember({ memberId }),
  });

  const [open, setOpen] = useState(false);
  const defaultAbteilung = abteilungen
    .filter((a) => !a.austrittsdatum && a.name)
    .map((a) => a.name)
    .join(", ");

  const [austrittDatum, setAustrittDatum] = useState(() => toDateInput(member.austritt));
  const [abteilung, setAbteilung] = useState(defaultAbteilung);
  const [abweichend, setAbweichend] = useState(false);
  const [empf, setEmpf] = useState({
    anrede: "",
    vorname: "",
    nachname: "",
    strasse: "",
    plz: "",
    ort: "",
  });
  const [isFamily, setIsFamily] = useState(false);
  const [family, setFamily] = useState<FamilyRow[]>([]);

  function prefillEmpfaengerFromVertreter() {
    const name = splitName(str(member.vertreterName));
    const haus = str(member.vertreterHausnummer);
    const strasse = [str(member.vertreterStrasse), haus].filter(Boolean).join(" ");
    setEmpf({
      anrede: str(member.vertreterAnrede),
      vorname: name.vorname,
      nachname: name.nachname,
      strasse,
      plz: str(member.vertreterPlz),
      ort: str(member.vertreterOrt),
    });
  }

  const generate = useMutation({
    mutationFn: () =>
      orpc.cancellations.generate({
        memberId,
        austrittDatum,
        abteilung: abteilung.trim() || null,
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
      triggerDownloadBase64(res.filename, res.base64, "application/pdf");
      toast.success("Austrittsbestätigung erstellt");
      setOpen(false);
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
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Erstellen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open ? (
          <form
            className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              generate.mutate();
            }}
          >
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="austritt-datum">Austritt zum</Label>
                <Input
                  id="austritt-datum"
                  type="date"
                  required
                  value={austrittDatum}
                  onChange={(e) => setAustrittDatum(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="austritt-abteilung">Abteilung(en)</Label>
                <Input
                  id="austritt-abteilung"
                  value={abteilung}
                  onChange={(e) => setAbteilung(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>

            <Switch
              id="austritt-abweichend"
              label="Abweichender Empfänger"
              description="Brief geht an eine andere Person (z. B. Eltern oder Zahler)."
              checked={abweichend}
              onChange={(e) => {
                const on = e.target.checked;
                setAbweichend(on);
                if (on && !empf.nachname && !empf.vorname) prefillEmpfaengerFromVertreter();
              }}
            />

            {abweichend ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
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

            <Switch
              id="austritt-familie"
              label="Familienmitgliedschaft"
              description="Weitere Mitglieder auf einem Schreiben zusammenfassen."
              checked={isFamily}
              onChange={(e) => setIsFamily(e.target.checked)}
            />

            {isFamily ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
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
                            family.map((r, j) => (j === i ? { ...r, vorname: e.target.value } : r)),
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
                      <Input
                        id={`fam-geb-${i}`}
                        type="date"
                        value={row.geburtsdatum}
                        onChange={(e) =>
                          setFamily(
                            family.map((r, j) =>
                              j === i ? { ...r, geburtsdatum: e.target.value } : r,
                            ),
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
                  <span className="font-medium">{row.displayName}</span>
                  <span className="text-xs text-muted-foreground">
                    Austritt zum {row.austrittDatum} · erstellt {formatDateTime(row.createdAt)}
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
