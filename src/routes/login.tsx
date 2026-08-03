import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { FormFieldError } from "~/components/forms/FormFieldError";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { VersionChip } from "~/components/ui/version-chip";
import { signIn } from "~/lib/auth-client";
import { validateRequiredEmail, validateRequiredPassword } from "~/lib/auth-form-validation";
import { useBranding } from "~/lib/branding";
import { orpc } from "~/lib/orpc";
import { COPYRIGHT } from "~/lib/release-notes";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { expired?: boolean; redirect?: string } => ({
    expired:
      search.expired === true || search.expired === "1" || search.expired === "true"
        ? true
        : undefined,
    // Only accept in-app paths as a return target, so the redirect can't be
    // bent into an open redirect to another origin.
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/app")
        ? search.redirect
        : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { expired, redirect } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  // First-boot rescue: if no users exist yet, send the operator to /setup
  // instead of leaving them stranded on a login form for an empty database.
  const setupStatus = useQuery({
    queryKey: ["auth.setupStatus"],
    queryFn: () => orpc.auth.setupStatus(),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (setupStatus.data?.needsSetup) {
      navigate({ to: "/setup", replace: true });
    }
  }, [setupStatus.data?.needsSetup, navigate]);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await signIn.email({
        email: value.email.trim(),
        password: value.password,
      });
      if (result.error) {
        setError(result.error.message ?? "Anmeldung fehlgeschlagen.");
        return;
      }
      navigate({ to: redirect ?? "/app" });
    },
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 size-[44rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 right-1/3 size-[32rem] rounded-full bg-primary/10 blur-3xl"
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Card className="relative w-full max-w-sm shadow-elevated">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-border shadow-card">
            <img src={branding.logoSrc} alt={branding.name} className="size-14 object-contain" />
          </div>
          <CardTitle className="text-xl">{branding.name}</CardTitle>
          <CardDescription>Vereinsverwaltung. Bitte anmelden.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            {expired ? (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.
              </p>
            ) : null}
            <form.Field
              name="email"
              validators={{
                onBlur: ({ value }) => validateRequiredEmail(value),
              }}
            >
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete="email"
                    aria-invalid={field.state.meta.errors.length > 0}
                    required
                  />
                  <FormFieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field
              name="password"
              validators={{
                onBlur: ({ value }) => validateRequiredPassword(value),
              }}
            >
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Passwort</Label>
                    <Link
                      to="/passwort-vergessen"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Passwort vergessen?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete="current-password"
                    aria-invalid={field.state.meta.errors.length > 0}
                    required
                  />
                  <FormFieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting} className="w-full">
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LogIn className="size-4" />
                  )}
                  {isSubmitting ? "Anmelden…" : "Anmelden"}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>

      <div className="absolute bottom-4 flex flex-col items-center gap-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{branding.name}</span>
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
