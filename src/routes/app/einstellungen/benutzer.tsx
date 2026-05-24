import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/benutzer")({
  component: UsersPage,
});

function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => orpc.auth.listUsers() });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "vorstand" | "readonly">("readonly");
  const [msg, setMsg] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => orpc.auth.invite({ email, role }),
    onSuccess: (data) => {
      setMsg(
        data.emailSent
          ? `Einladung an ${email} versendet.`
          : `Einladung erstellt, E-Mail konnte nicht versendet werden: ${data.emailError}`,
      );
      setEmail("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const setRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "admin" | "vorstand" | "readonly" }) =>
      orpc.auth.setRole(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Benutzer-Verwaltung</h1>
      <Card>
        <CardHeader>
          <CardTitle>Einladung versenden</CardTitle>
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
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Rolle</Label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="readonly">Readonly</option>
                <option value="vorstand">Vorstand</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button type="submit" disabled={invite.isPending}>
              <UserPlus className="size-4" /> Einladen
            </Button>
            {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Benutzer</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">E-Mail</th>
                <th className="py-2">Name</th>
                <th className="py-2">Rolle</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">{u.name}</td>
                  <td className="py-2">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        setRoleMutation.mutate({
                          userId: u.id,
                          role: e.target.value as "admin" | "vorstand" | "readonly",
                        })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
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
        </CardContent>
      </Card>
    </div>
  );
}
