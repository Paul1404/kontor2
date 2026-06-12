import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { signIn } from "~/lib/auth-client";
import { useBranding } from "~/lib/branding";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const branding = useBranding();
  const { token } = Route.useParams();
  const navigate = useNavigate();

  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => orpc.auth.getInvitation({ token }),
    retry: false,
  });

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => orpc.auth.acceptInvitation({ token, name: name.trim(), password }),
    onSuccess: async () => {
      // Auto-sign-in so the user lands in the app instead of having to log
      // in again with the password they just typed.
      if (!invite.data) return;
      const result = await signIn.email({ email: invite.data.email, password });
      if (result.error) {
        navigate({ to: "/login" });
        return;
      }
      navigate({ to: "/app" });
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Einladung konnte nicht eingelöst werden.");
    },
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 size-[44rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Card className="relative w-full max-w-sm shadow-elevated">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-border shadow-card">
            <img src={branding.logoSrc} alt={branding.name} className="size-14 object-contain" />
          </div>
          <CardTitle className="text-xl">Einladung einlösen</CardTitle>
          <CardDescription>{branding.name} Vereinsverwaltung</CardDescription>
        </CardHeader>
        <CardContent>
          {invite.isLoading ? (
            <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Wird geprüft…
            </div>
          ) : invite.isError || !invite.data ? (
            <div className="flex flex-col items-center gap-2 py-4 text-sm text-destructive">
              <XCircle className="size-5" />
              {invite.error instanceof Error
                ? invite.error.message
                : "Einladung ungültig oder abgelaufen."}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                if (password.length < 12) {
                  setError("Passwort muss mindestens 12 Zeichen lang sein.");
                  return;
                }
                if (password !== passwordConfirm) {
                  setError("Passwörter stimmen nicht überein.");
                  return;
                }
                if (!name.trim()) {
                  setError("Name ist erforderlich.");
                  return;
                }
                accept.mutate();
              }}
              className="flex flex-col gap-4"
            >
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5 text-brand" />
                  <span>
                    Rolle: <span className="font-medium text-foreground">{invite.data.role}</span>
                  </span>
                </div>
                <div className="mt-1">
                  E-Mail: <span className="font-medium text-foreground">{invite.data.email}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Passwort (mind. 12 Zeichen)</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password-confirm">Passwort wiederholen</Label>
                <Input
                  id="password-confirm"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </div>
              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={accept.isPending} className="w-full">
                {accept.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Konto anlegen und anmelden
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="absolute bottom-4 text-xs text-muted-foreground">{branding.name}</p>
    </div>
  );
}
