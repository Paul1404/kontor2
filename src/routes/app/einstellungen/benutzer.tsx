import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, UserPlus, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/benutzer")({
  component: UsersPage,
});

type Msg = { kind: "ok" | "error"; text: string };

function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => orpc.auth.listUsers() });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Benutzer-Verwaltung</h1>
        <p className="text-sm text-muted-foreground">
          Einladungen und Rollen für Mitarbeiter im Vorstand und Admin-Team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Einladung versenden</CardTitle>
          <CardDescription>Der Empfänger setzt sein Passwort über den Link in der E-Mail.</CardDescription>
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
                {users.data?.map((u) => (
                  <tr key={u.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.name}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          setRoleMutation.mutate({
                            userId: u.id,
                            role: e.target.value as "admin" | "vorstand" | "readonly",
                          })
                        }
                        className="h-8 rounded-md border border-input bg-card px-2 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      >
                        <option value="readonly">Readonly</option>
                        <option value="vorstand">Vorstand</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
