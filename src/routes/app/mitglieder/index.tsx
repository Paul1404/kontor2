import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { triggerDownload } from "~/lib/download";
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

  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";

  const list = useQuery({
    queryKey: ["members.list", { q, status, abteilungId, includeAusgetretene, page }],
    queryFn: () =>
      orpc.members.list({ q, status, abteilungId, includeAusgetretene, page, pageSize }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Mitglieder</h1>
          <p className="text-sm text-muted-foreground">Suchen, filtern und Profile öffnen.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const res = await orpc.reports.membersExport({
                q,
                status,
                abteilungId,
                includeAusgetretene,
              });
              triggerDownload(res.filename, res.content, "text/csv;charset=utf-8");
            }}
          >
            <Download className="size-4" /> Als CSV
          </Button>
          {canEdit ? (
            <Link to="/app/mitglieder/neu">
              <Button>
                <Plus className="size-4" /> Neues Mitglied
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Name, Mitgliedsnummer, E-Mail, Ort"
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
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="">Alle Abteilungen</option>
            {abteilungen.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.count})
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-soft">
            <input
              type="checkbox"
              checked={includeAusgetretene}
              onChange={(e) => setIncludeAusgetretene(e.target.checked)}
              className="size-4 accent-primary"
            />
            <span className="text-muted-foreground">Ausgetretene anzeigen</span>
          </label>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Mitgl.-Nr.</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Ort</th>
                <th className="px-4 py-3 font-medium">E-Mail</th>
                <th className="px-4 py-3 font-medium">Eintritt</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Wird geladen…
                    </span>
                  </td>
                </tr>
              ) : list.data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Keine Mitglieder gefunden.
                  </td>
                </tr>
              ) : (
                (list.data?.rows ?? []).map((row) => {
                  const m = row as MemberRow;
                  return (
                    <tr key={m.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {m.mitglnr ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: m.mitglnr ?? String(m.adrNr) }}
                          className="font-medium text-primary hover:underline"
                        >
                          {[m.nachname, m.vorname].filter(Boolean).join(", ")}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{[m.plz, m.ort].filter(Boolean).join(" ")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.email ?? ""}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(m.eintritt)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge member={m} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">{list.data?.total ?? 0} Einträge</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
            <span className="text-muted-foreground">Seite {page}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={(list.data?.rows.length ?? 0) < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              Weiter <ChevronRight className="size-3.5" />
            </Button>
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
