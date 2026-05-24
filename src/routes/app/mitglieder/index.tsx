import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Status = "aktiv" | "passiv" | "ausgetreten" | "verstorben" | "alle";
type MemberRow = {
  id: string;
  adrNr: number;
  mitglnr: string | null;
  vorname: string | null;
  nachname: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  eintritt: string | Date | null;
  austritt: string | Date | null;
  verstorbenAm: string | Date | null;
  aktivPasiv: string | null;
};

export const Route = createFileRoute("/app/mitglieder/")({
  component: MembersListPage,
});

function MembersListPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("aktiv");
  const [abteilungId, setAbteilungId] = useState<string | null>(null);
  const [includeAusgetretene, setIncludeAusgetretene] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const abteilungen = useQuery({
    queryKey: ["abteilungen"],
    queryFn: () => orpc.members.abteilungenList(),
  });

  const list = useQuery({
    queryKey: ["members.list", { q, status, abteilungId, includeAusgetretene, page }],
    queryFn: () =>
      orpc.members.list({ q, status, abteilungId, includeAusgetretene, page, pageSize }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mitglieder</h1>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative flex-1 min-w-60">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Suche nach Name, Mitgliedsnummer, E-Mail, Ort"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="aktiv">Aktiv</option>
            <option value="passiv">Passiv</option>
            <option value="ausgetreten">Ausgetreten</option>
            <option value="verstorben">Verstorben</option>
            <option value="alle">Alle</option>
          </select>
          <select
            value={abteilungId ?? ""}
            onChange={(e) => {
              setAbteilungId(e.target.value || null);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Alle Abteilungen</option>
            {abteilungen.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.count})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeAusgetretene}
              onChange={(e) => setIncludeAusgetretene(e.target.checked)}
            />
            Ausgetretene anzeigen
          </label>
        </CardContent>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Mitgl.-Nr.</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Ort</th>
                <th className="px-4 py-2 font-medium">E-Mail</th>
                <th className="px-4 py-2 font-medium">Eintritt</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Wird geladen...
                  </td>
                </tr>
              ) : list.data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Keine Mitglieder gefunden.
                  </td>
                </tr>
              ) : (
                (list.data?.rows ?? []).map((row) => {
                  const m = row as MemberRow;
                  return (
                    <tr key={m.id} className="border-t hover:bg-accent/50">
                      <td className="px-4 py-2 tabular-nums">{m.mitglnr ?? "-"}</td>
                      <td className="px-4 py-2">
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: m.mitglnr ?? String(m.adrNr) }}
                          className="text-primary hover:underline"
                        >
                          {[m.nachname, m.vorname].filter(Boolean).join(", ")}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{[m.plz, m.ort].filter(Boolean).join(" ")}</td>
                      <td className="px-4 py-2 text-muted-foreground">{m.email ?? ""}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(m.eintritt)}</td>
                      <td className="px-4 py-2">
                        <StatusBadge member={m} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
          <span>{list.data?.total ?? 0} Einträge</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Zurück
            </button>
            <span>Seite {page}</span>
            <button
              type="button"
              className="rounded-md border px-3 py-1 disabled:opacity-50"
              disabled={(list.data?.rows.length ?? 0) < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ member }: { member: MemberRow }) {
  if (member.verstorbenAm) return <Badge variant="secondary">Verstorben</Badge>;
  if (member.austritt) return <Badge variant="warning">Ausgetreten</Badge>;
  if (member.aktivPasiv === "P") return <Badge variant="secondary">Passiv</Badge>;
  return <Badge variant="success">Aktiv</Badge>;
}
