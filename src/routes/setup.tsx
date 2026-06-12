import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { VersionChip } from "~/components/ui/version-chip";
import { signIn } from "~/lib/auth-client";
import { orpc } from "~/lib/orpc";
import { COPYRIGHT } from "~/lib/release-notes";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();

  const status = useQuery({
    queryKey: ["auth.setupStatus"],
    queryFn: () => orpc.auth.setupStatus(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: () => orpc.auth.completeSetup({ email: email.trim(), password, name: name.trim() }),
    onSuccess: async () => {
      const result = await signIn.email({ email: email.trim(), password });
      if (result.error) {
        navigate({ to: "/login" });
        return;
      }
      navigate({ to: "/app" });
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Setup fehlgeschlagen.");
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
            <img src="/logo.png" alt="SV Untereuerheim" className="size-14 object-contain" />
          </div>
          <CardTitle className="text-xl">Erstes Admin-Konto anlegen</CardTitle>
          <CardDescription>SV Untereuerheim Vereinsverwaltung</CardDescription>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Wird geprüft…
            </div>
          ) : status.isError ? (
            <div className="flex flex-col items-center gap-2 py-4 text-sm text-destructive">
              <XCircle className="size-5" />
              Status konnte nicht geladen werden.
            </div>
          ) : !status.data?.needsSetup ? (
            <div className="flex flex-col items-center gap-3 py-4 text-sm">
              <ShieldCheck className="size-6 text-brand" />
              <p className="text-center text-muted-foreground">
                Setup wurde bereits abgeschlossen.
              </p>
              <Button onClick={() => navigate({ to: "/login" })} className="w-full">
                Zur Anmeldung
              </Button>
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
                if (!email.trim()) {
                  setError("E-Mail ist erforderlich.");
                  return;
                }
                setup.mutate();
              }}
              className="flex flex-col gap-4"
            >
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Diese Seite ist nur sichtbar, solange noch kein Benutzer existiert. Das angelegte
                Konto erhält die Rolle <span className="font-medium text-foreground">admin</span>.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
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
              <Button type="submit" disabled={setup.isPending} className="w-full">
                {setup.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Admin-Konto anlegen
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="absolute bottom-4 flex flex-col items-center gap-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>SV Untereuerheim 1945 e.V.</span>
          <span aria-hidden className="text-muted-foreground/40">
            |
          </span>
          <VersionChip variant="muted" />
        </div>
        <span className="text-[11px] text-muted-foreground/70">{COPYRIGHT}</span>
      </div>
    </div>
  );
}
