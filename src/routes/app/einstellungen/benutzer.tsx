import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MailPlus,
  Save,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog, TypeToConfirmDialog } from "~/components/ui/confirm-dialog";
import { CopyButton } from "~/components/ui/copy-button";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError, QueryErrorRow } from "~/components/ui/query-error";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toaster";
import { authClient } from "~/lib/auth-client";
import { EMPTY_VALUE, formatDate } from "~/lib/format";
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
  const [pendingDowngrade, setPendingDowngrade] = useState<{
    userId: string;
    email: string;
    next: "vorstand" | "readonly";
  } | null>(null);

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
      qc.invalidateQueries({ queryKey: ["invitations"] });
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

  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () => orpc.auth.listInvitations(),
  });

  const [pendingDelete, setPendingDelete] = useState<{ userId: string; email: string } | null>(
    null,
  );
  const [pendingBan, setPendingBan] = useState<{ userId: string; email: string } | null>(null);
  const [banReason, setBanReason] = useState("");

  const deleteUser = useMutation({
    mutationFn: (userId: string) => orpc.auth.deleteUser({ userId }),
    onSuccess: (_d, _userId) => {
      toast.success("Benutzer gelöscht.");
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const banUser = useMutation({
    mutationFn: (input: { userId: string; reason?: string }) => orpc.auth.banUser(input),
    onSuccess: () => {
      toast.success("Benutzer gesperrt.");
      setPendingBan(null);
      setBanReason("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const unbanUser = useMutation({
    mutationFn: (userId: string) => orpc.auth.unbanUser({ userId }),
    onSuccess: () => {
      toast.success("Sperre aufgehoben.");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) => orpc.auth.revokeInvite({ invitationId }),
    onSuccess: () => {
      toast.success("Einladung widerrufen.");
      qc.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const revokeSessions = useMutation({
    mutationFn: (userId: string) => orpc.auth.revokeUserSessions({ userId }),
    onSuccess: () => toast.success("Sitzungen beendet. Der Benutzer muss sich neu anmelden."),
    onError: (err) => toast.error((err as Error).message),
  });

  const resetPassword = useMutation({
    mutationFn: (userId: string) => orpc.auth.resetUserPassword({ userId }),
    onSuccess: (data) => setTempPassword({ email: data.email, password: data.tempPassword }),
    onError: (err) => toast.error((err as Error).message),
  });

  const sendResetLink = useMutation({
    mutationFn: (userId: string) => orpc.auth.sendPasswordResetLink({ userId }),
    onSuccess: (data) =>
      toast.success(`Link zum Zurücksetzen an ${data.email} versendet. Er ist eine Stunde gültig.`),
    onError: (err) => toast.error((err as Error).message),
  });

  // Change own password (better-auth client, not an oRPC procedure).
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pwNext.length < 12) {
      setPwMsg({ kind: "error", text: "Das neue Passwort muss mindestens 12 Zeichen haben." });
      return;
    }
    setPwBusy(true);
    const res = await authClient.changePassword({
      currentPassword: pwCurrent,
      newPassword: pwNext,
      revokeOtherSessions: true,
    });
    setPwBusy(false);
    if (res.error) {
      setPwMsg({
        kind: "error",
        text: res.error.message ?? "Passwort konnte nicht geändert werden.",
      });
      return;
    }
    setPwCurrent("");
    setPwNext("");
    setPwMsg({ kind: "ok", text: "Passwort geändert. Andere Sitzungen wurden beendet." });
  }

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
              <strong>Readonly</strong>: Sieht Übersicht, Mitglieder und Änderungsprotokoll. Kann
              nichts ändern. Geeignet für Personen, die Mitgliedsdaten nur einsehen sollen.
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
              <strong>Admin</strong>: Vorstand-Rechte plus Vereinsdaten, E-Mail, Beitragsarten,
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
                  <th className="px-4 py-3 text-right font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Wird geladen…
                    </td>
                  </tr>
                ) : users.isError ? (
                  <QueryErrorRow colSpan={4} onRetry={() => users.refetch()} />
                ) : users.data && users.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Keine Benutzer.
                    </td>
                  </tr>
                ) : (
                  users.data?.map((u) => {
                    const isSelf = u.id === me.data?.id;
                    const busy =
                      (deleteUser.isPending && deleteUser.variables === u.id) ||
                      (banUser.isPending && banUser.variables?.userId === u.id) ||
                      (unbanUser.isPending && unbanUser.variables === u.id);
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {u.email}
                            {isSelf ? (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Sie
                              </span>
                            ) : null}
                            {u.banned ? <Badge variant="destructive">Gesperrt</Badge> : null}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{u.name}</td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={isSelf || setRoleMutation.isPending}
                            title={isSelf ? "Eigene Rolle kann nicht geändert werden." : undefined}
                            onChange={(e) => {
                              const next = e.target.value as "admin" | "vorstand" | "readonly";
                              if (u.role === "admin" && next !== "admin") {
                                setPendingDowngrade({ userId: u.id, email: u.email, next });
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
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {isSelf ? (
                              <span className="text-xs text-muted-foreground">Eigenes Konto</span>
                            ) : (
                              <>
                                {u.banned ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => unbanUser.mutate(u.id)}
                                  >
                                    {busy ? (
                                      <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                      <ShieldOff className="size-4" />
                                    )}
                                    Entsperren
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => setPendingBan({ userId: u.id, email: u.email })}
                                  >
                                    <Ban className="size-4" />
                                    Sperren
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={`Passwort von ${u.email} zurücksetzen`}
                                  title="Passwort zurücksetzen"
                                  disabled={resetPassword.isPending}
                                  onClick={() => resetPassword.mutate(u.id)}
                                >
                                  {resetPassword.isPending && resetPassword.variables === u.id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <KeyRound className="size-4" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={`Link zum Zurücksetzen an ${u.email} senden`}
                                  title="Link zum Zurücksetzen senden"
                                  disabled={sendResetLink.isPending}
                                  onClick={() => sendResetLink.mutate(u.id)}
                                >
                                  {sendResetLink.isPending && sendResetLink.variables === u.id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <MailPlus className="size-4" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={`Alle Sitzungen von ${u.email} beenden`}
                                  title="Abmelden (alle Sitzungen beenden)"
                                  disabled={revokeSessions.isPending}
                                  onClick={() => revokeSessions.mutate(u.id)}
                                >
                                  {revokeSessions.isPending && revokeSessions.variables === u.id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <LogOut className="size-4" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={`Benutzer ${u.email} löschen`}
                                  disabled={busy}
                                  onClick={() => setPendingDelete({ userId: u.id, email: u.email })}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            )}
                          </div>
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

      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-5 text-muted-foreground" />
            Einladungen
          </CardTitle>
          <CardDescription>
            Versendete Einladungen und ihr Status. Offene Einladungen lassen sich widerrufen, bevor
            sie eingelöst werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">E-Mail</th>
                  <th className="px-4 py-3 font-medium">Rolle</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Läuft ab</th>
                  <th className="px-4 py-3 text-right font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invitations.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Wird geladen…
                    </td>
                  </tr>
                ) : invitations.isError ? (
                  <QueryErrorRow colSpan={5} onRetry={() => invitations.refetch()} />
                ) : invitations.data && invitations.data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Keine Einladungen.
                    </td>
                  </tr>
                ) : (
                  invitations.data?.map((inv) => {
                    const role =
                      inv.role === "admin"
                        ? "Admin"
                        : inv.role === "vorstand"
                          ? "Vorstand"
                          : "Readonly";
                    return (
                      <tr key={inv.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">{inv.email}</td>
                        <td className="px-4 py-3 text-muted-foreground">{role}</td>
                        <td className="px-4 py-3">
                          {inv.status === "pending" ? (
                            <Badge variant="info">Offen</Badge>
                          ) : inv.status === "accepted" ? (
                            <Badge variant="success">Eingelöst</Badge>
                          ) : inv.status === "revoked" ? (
                            <Badge variant="secondary">Widerrufen</Badge>
                          ) : (
                            <Badge variant="warning">Abgelaufen</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {inv.status === "pending" ? formatDate(inv.expiresAt) : EMPTY_VALUE}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            {inv.status === "pending" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                  revokeInvite.isPending && revokeInvite.variables === inv.id
                                }
                                onClick={() => revokeInvite.mutate(inv.id)}
                              >
                                {revokeInvite.isPending && revokeInvite.variables === inv.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <XCircle className="size-4" />
                                )}
                                Widerrufen
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
                            )}
                          </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-muted-foreground" />
            Mein Passwort
          </CardTitle>
          <CardDescription>
            Ändert das Passwort Ihres eigenen Kontos. Andere offene Sitzungen werden dabei beendet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={onChangePassword}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-current">Aktuelles Passwort</Label>
              <Input
                id="pw-current"
                type="password"
                required
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                className="w-56"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-next">Neues Passwort</Label>
              <Input
                id="pw-next"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                className="w-56"
              />
            </div>
            <Button type="submit" disabled={pwBusy}>
              {pwBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Passwort ändern
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">Mindestens 12 Zeichen.</p>
          {pwMsg ? (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm shadow-soft ${
                pwMsg.kind === "ok"
                  ? "border-success/30 bg-success/10"
                  : "border-destructive/30 bg-destructive/10"
              }`}
            >
              {pwMsg.kind === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <span className="break-words">{pwMsg.text}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDowngrade !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDowngrade(null);
        }}
        title="Administrator herabsetzen?"
        description={
          pendingDowngrade
            ? `${pendingDowngrade.email} verliert die Administratorrechte und wird zu ${pendingDowngrade.next === "vorstand" ? "Vorstand" : "Readonly"}.`
            : undefined
        }
        confirmLabel="Herabsetzen"
        destructive
        loading={setRoleMutation.isPending}
        onConfirm={() => {
          if (!pendingDowngrade) return;
          setRoleMutation.mutate({ userId: pendingDowngrade.userId, role: pendingDowngrade.next });
          setPendingDowngrade(null);
        }}
      />

      <ConfirmDialog
        open={pendingBan !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPendingBan(null);
            setBanReason("");
          }
        }}
        title="Benutzer sperren?"
        description={
          pendingBan
            ? `${pendingBan.email} kann sich nicht mehr anmelden. Laufende Sitzungen werden beendet. Die Sperre lässt sich jederzeit wieder aufheben.`
            : undefined
        }
        confirmLabel="Sperren"
        destructive
        loading={banUser.isPending}
        onConfirm={() => {
          if (!pendingBan) return;
          const reason = banReason.trim();
          banUser.mutate({ userId: pendingBan.userId, reason: reason || undefined });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ban-reason">Grund (optional)</Label>
          <Textarea
            id="ban-reason"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            maxLength={500}
            placeholder="z. B. Mitarbeiter ausgeschieden"
          />
        </div>
      </ConfirmDialog>

      <TypeToConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Benutzer endgültig löschen?"
        description={
          pendingDelete ? (
            <span>
              Das Konto von <strong>{pendingDelete.email}</strong> wird mit allen Sitzungen,
              Zugängen und API-Schlüsseln unwiderruflich entfernt. Soll der Zugang nur vorübergehend
              gesperrt werden, nutzen Sie stattdessen „Sperren“.
            </span>
          ) : undefined
        }
        confirmLabel="Endgültig löschen"
        confirmPhrase={pendingDelete?.email ?? ""}
        loading={deleteUser.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteUser.mutate(pendingDelete.userId);
        }}
      />

      <ConfirmDialog
        open={tempPassword !== null}
        onOpenChange={(o) => {
          if (!o) setTempPassword(null);
        }}
        title="Temporäres Passwort"
        description={
          tempPassword
            ? `Geben Sie ${tempPassword.email} dieses Passwort. Es wird nur jetzt angezeigt. Alle bisherigen Sitzungen wurden beendet; beim nächsten Login sollte ein eigenes Passwort vergeben werden.`
            : undefined
        }
        confirmLabel="Fertig"
        cancelLabel="Schließen"
        onConfirm={() => setTempPassword(null)}
      >
        {tempPassword ? (
          <div className="flex items-center justify-between gap-3">
            <code className="break-all font-mono text-sm text-foreground">
              {tempPassword.password}
            </code>
            <CopyButton value={tempPassword.password} label="Passwort" />
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
