import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Save,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError, QueryErrorRow } from "~/components/ui/query-error";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/benutzer")({
  component: UsersPage,
});

type Msg = { kind: "ok" | "error"; text: string };

function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => orpc.auth.listUsers() });
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "vorstand" | "readonly">("readonly");
  const [msg, setMsg] = useState<Msg | null>(null);

  const invite = useMutation({
    mutationFn: () => orpc.auth.invite({ email, role }),
    onSuccess: (data) => {
      setMsg(
        data.emailSent
          ? { kind: "ok", text: `Einladung an ${email} versendet.` }
          : {
              kind: "error",
              text: `Einladung erstellt, E-Mail konnte nicht versendet werden: ${data.emailError}`,
            },
      );
      setEmail("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  const setRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "admin" | "vorstand" | "readonly" }) =>
      orpc.auth.setRole(input),
    onSuccess: () => {
      setMsg(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  const sessionSettings = useQuery({
    queryKey: ["sessionSettings"],
    queryFn: () => orpc.settings.getSessionSettings(),
  });
  const [sessionForm, setSessionForm] = useState<{ days: string; hours: string } | null>(null);
  const [sessionMsg, setSessionMsg] = useState<Msg | null>(null);
  useEffect(() => {
    if (sessionSettings.data && !sessionForm) {
      setSessionForm({
        days: String(sessionSettings.data.sessionExpiresInDays),
        hours: String(sessionSettings.data.sessionUpdateAgeHours),
      });
    }
  }, [sessionSettings.data, sessionForm]);

  const saveSession = useMutation({
    mutationFn: (input: { sessionExpiresInDays: number; sessionUpdateAgeHours: number }) =>
      orpc.settings.updateSessionSettings(input),
    onSuccess: () => {
      setSessionMsg({ kind: "ok", text: "Sitzungseinstellungen gespeichert." });
      qc.invalidateQueries({ queryKey: ["sessionSettings"] });
    },
    onError: (err) => setSessionMsg({ kind: "error", text: (err as Error).message }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Benutzer-Verwaltung</h1>
        <p className="text-sm text-muted-foreground">
          Einladungen und Rollen für Mitarbeiter im Vorstand und Admin-Team.
        </p>
      </div>

      <InfoBox title="Welche Rolle bekommt wer?" collapsible defaultOpen={false}>
        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <strong>Readonly</strong>: Sieht Mitglieder, Berichte und Forderungen. Kann nichts
              ändern. Geeignet für Trainer oder Abteilungsleiter, die nur Listen einsehen wollen.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <strong>Vorstand</strong>: Operatives Tagesgeschäft. Mitglieder anlegen und
              bearbeiten, Beitrags- und Mahnläufe starten, Portal-Anfragen freigeben, Berichte
              exportieren. Keine Stamm- und Systemeinstellungen.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <strong>Admin</strong>: Vorstand-Rechte plus Vereinsdaten, SMTP, Beitragsarten,
              Abteilungen, Benutzer-Rollen, Snapshots und der Adminbereich (Restore, endgültiges
              Löschen, Wipe). Es muss immer mindestens ein Admin existieren.
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Rollenwechsel wirken sofort beim nächsten Request. Bestehende Sessions bleiben aktiv, aber
          Berechtigungen werden serverseitig pro Aufruf geprüft.
        </p>
      </InfoBox>

      <Card>
        <CardHeader>
          <CardTitle>Einladung versenden</CardTitle>
          <CardDescription>
            Der Empfänger setzt sein Passwort über den Link in der E-Mail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-72"
                placeholder="name@example.de"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Rolle</Label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="readonly">Readonly</option>
                <option value="vorstand">Vorstand</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Einladen
            </Button>
          </form>
          {msg ? (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm shadow-soft ${
                msg.kind === "ok"
                  ? "border-success/30 bg-success/10"
                  : "border-destructive/30 bg-destructive/10"
              }`}
            >
              {msg.kind === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <span className="break-words">{msg.text}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle>Benutzer</CardTitle>
          <CardDescription>Alle Konten und ihre Rollen.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">E-Mail</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Rolle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.isLoading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                      Wird geladen…
                    </td>
                  </tr>
                ) : users.isError ? (
                  <QueryErrorRow colSpan={3} onRetry={() => users.refetch()} />
                ) : users.data && users.data.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                      Keine Benutzer.
                    </td>
                  </tr>
                ) : (
                  users.data?.map((u) => {
                    const isSelf = u.id === me.data?.id;
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">
                          {u.email}
                          {isSelf ? (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Sie
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{u.name}</td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={isSelf || setRoleMutation.isPending}
                            title={isSelf ? "Eigene Rolle kann nicht geändert werden." : undefined}
                            onChange={(e) => {
                              const next = e.target.value as "admin" | "vorstand" | "readonly";
                              if (
                                u.role === "admin" &&
                                next !== "admin" &&
                                !window.confirm(
                                  `${u.email} wirklich von Administrator auf ${next} herabsetzen?`,
                                )
                              ) {
                                return;
                              }
                              setRoleMutation.mutate({ userId: u.id, role: next });
                            }}
                            className="h-8 rounded-md border border-input bg-card px-2 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="readonly">Readonly</option>
                            <option value="vorstand">Vorstand</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" />
            Sitzungen
          </CardTitle>
          <CardDescription>
            Wie lange eine Anmeldung gültig bleibt. Die Änderung gilt für neue Anmeldungen, laufende
            Sitzungen behalten ihre bereits vergebene Gültigkeit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionSettings.isError ? (
            <QueryError onRetry={() => sessionSettings.refetch()} error={sessionSettings.error} />
          ) : !sessionForm ? (
            <p className="text-sm text-muted-foreground">Wird geladen…</p>
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setSessionMsg(null);
                saveSession.mutate({
                  sessionExpiresInDays: Number(sessionForm.days),
                  sessionUpdateAgeHours: Number(sessionForm.hours),
                });
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-days">Sitzungsdauer (Tage)</Label>
                <Input
                  id="session-days"
                  type="number"
                  required
                  min={sessionSettings.data?.limits.expiresInDays.min}
                  max={sessionSettings.data?.limits.expiresInDays.max}
                  value={sessionForm.days}
                  onChange={(e) => setSessionForm({ ...sessionForm, days: e.target.value })}
                  className="w-44"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-hours">Verlängerungsintervall (Stunden)</Label>
                <Input
                  id="session-hours"
                  type="number"
                  required
                  min={sessionSettings.data?.limits.updateAgeHours.min}
                  max={sessionSettings.data?.limits.updateAgeHours.max}
                  value={sessionForm.hours}
                  onChange={(e) => setSessionForm({ ...sessionForm, hours: e.target.value })}
                  className="w-56"
                />
              </div>
              <Button type="submit" disabled={saveSession.isPending}>
                {saveSession.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Speichern
              </Button>
            </form>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Innerhalb der Sitzungsdauer wird die Anmeldung bei Aktivität automatisch verlängert. Das
            Verlängerungsintervall legt fest, wie oft das geschieht. Es darf die Sitzungsdauer nicht
            überschreiten.
          </p>
          {sessionMsg ? (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm shadow-soft ${
                sessionMsg.kind === "ok"
                  ? "border-success/30 bg-success/10"
                  : "border-destructive/30 bg-destructive/10"
              }`}
            >
              {sessionMsg.kind === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <span className="break-words">{sessionMsg.text}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
