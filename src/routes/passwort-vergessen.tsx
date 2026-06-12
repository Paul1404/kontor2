import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { authClient } from "~/lib/auth-client";
import { useBranding } from "~/lib/branding";

export const Route = createFileRoute("/passwort-vergessen")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const branding = useBranding();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // Always land on the same confirmation regardless of whether the address
  // exists, so the page can't be used to probe which emails have an account.
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await authClient.requestPasswordReset({ email }).catch(() => undefined);
    setBusy(false);
    setSubmitted(true);
  }

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
          <CardTitle className="text-xl">Passwort vergessen</CardTitle>
          <CardDescription>
            Wir senden Ihnen einen Link zum Zurücksetzen an Ihre E-Mail-Adresse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <span>
                  Falls ein Konto zu dieser Adresse existiert, ist eine E-Mail mit einem Link
                  unterwegs. Der Link ist eine Stunde gültig.
                </span>
              </div>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                Zurück zur Anmeldung
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Link senden
              </Button>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                Zurück zur Anmeldung
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
