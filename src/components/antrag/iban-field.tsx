import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc } from "~/lib/orpc";

function formatIban(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/**
 * IBAN input with debounced server-side validation + BIC/bank lookup. Calls
 * the public `applications.lookupIban`; reports the resolved bank back to the
 * parent so the SEPA fields can auto-fill.
 */
export function IbanField({
  value,
  onChange,
  onResolved,
  error,
}: {
  value: string;
  onChange: (raw: string) => void;
  onResolved: (info: { bic: string | null; name: string | null }) => void;
  error?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "valid" | "invalid">("idle");

  useEffect(() => {
    const clean = value.replace(/\s/g, "").toUpperCase();
    if (clean.length < 15) {
      setState("idle");
      return;
    }
    setState("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await orpc.applications.lookupIban({ iban: clean });
        if (!res.valid) {
          setState("invalid");
          return;
        }
        setState("valid");
        onResolved({ bic: res.bic, name: res.name });
      } catch {
        // Network blip: don't block submission on the lookup.
        setState("valid");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [value, onResolved]);

  return (
    <Label className="flex flex-col gap-1.5">
      <span>IBAN *</span>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(formatIban(e.target.value))}
          placeholder="DE12 3456 7890 1234 5678 90"
          inputMode="text"
          autoCapitalize="characters"
          aria-invalid={state === "invalid" || Boolean(error)}
        />
        <span className="-translate-y-1/2 absolute top-1/2 right-3">
          {state === "loading" ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : state === "valid" ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : state === "invalid" ? (
            <XCircle className="size-4 text-destructive" />
          ) : null}
        </span>
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {state === "invalid" && !error ? (
        <span className="text-xs text-destructive">IBAN-Prüfsumme ist ungültig.</span>
      ) : null}
    </Label>
  );
}
