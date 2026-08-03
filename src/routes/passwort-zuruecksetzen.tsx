import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { FormFieldError } from "~/components/forms/FormFieldError";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { toast } from "~/components/ui/toaster";
import { authClient } from "~/lib/auth-client";
import { validateNewPassword, validatePasswordConfirmation } from "~/lib/auth-form-validation";
import { useBranding } from "~/lib/branding";

export const Route = createFileRoute("/passwort-zuruecksetzen")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const branding = useBranding();
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { password: "", confirm: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      if (!token) {
        setError("Der Link ist ungültig oder unvollständig.");
        return;
      }
      const res = await authClient.resetPassword({ newPassword: value.password, token });
      if (res.error) {
        setError(
          res.error.message ??
            "Zurücksetzen fehlgeschlagen. Der Link ist möglicherweise abgelaufen.",
        );
        return;
      }
      toast.success("Passwort gesetzt. Bitte melden Sie sich an.");
      navigate({ to: "/login" });
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
          <CardTitle className="text-xl">Neues Passwort</CardTitle>
          <CardDescription>Vergeben Sie ein neues Passwort für Ihr Konto.</CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
              className="flex flex-col gap-4"
            >
              <form.Field
                name="password"
                validators={{
                  onChange: ({ value }) => validateNewPassword(value),
                }}
              >
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password">Neues Passwort</Label>
                    <Input
                      id="password"
                      type="password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      aria-invalid={field.state.meta.errors.length > 0}
                      required
                    />
                    <FormFieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
              <form.Field
                name="confirm"
                validators={{
                  onChangeListenTo: ["password"],
                  onChange: ({ value, fieldApi }) =>
                    validatePasswordConfirmation(value, fieldApi.form.getFieldValue("password")),
                }}
              >
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="confirm">Passwort bestätigen</Label>
                    <Input
                      id="confirm"
                      type="password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
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
                      <KeyRound className="size-4" />
                    )}
                    Passwort speichern
                  </Button>
                )}
              </form.Subscribe>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Der Link ist ungültig oder unvollständig. Fordern Sie einen neuen an.
              </p>
              <Link
                to="/passwort-vergessen"
                className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                Neuen Link anfordern
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
