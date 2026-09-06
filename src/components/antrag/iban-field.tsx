import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Field } from "~/components/antrag/field";
import { Input } from "~/components/ui/input";
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
 * parent so the SEPA fields can auto-fill. The resolved bank is shown in the
 * reserved helper line, so nothing below the field moves.
 */
export function IbanField({
  value,
  onChange,
  onResolved,
  error,
  pulseNonce,
}: {
  value: string;
  onChange: (raw: string) => void;
  onResolved: (info: { bic: string | null; name: string | null }) => void;
  error?: string;
  pulseNonce?: number;
}) {
  const [state, setState] = useState<"idle" | "loading" | "valid" | "invalid">("idle");
  const [bank, setBank] = useState<string | null>(null);
  // The parent passes a fresh callback on every render; keep the latest one
  // out of the effect deps so a resolved bank does not restart the lookup.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  useEffect(() => {
    const clean = value.replace(/\s/g, "").toUpperCase();
    if (clean.length < 15) {
      setState("idle");
      setBank(null);
      return;
    }
    setState("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await orpc.applications.lookupIban({ iban: clean });
        if (!res.valid) {
          setState("invalid");
          setBank(null);
          return;
        }
        setState("valid");
        setBank(res.name);
        onResolvedRef.current({ bic: res.bic, name: res.name });
      } catch {
        // Network blip: don't block submission on the lookup.
        setState("valid");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [value]);

  const localError = error ?? (state === "invalid" ? "IBAN-Prüfsumme ist ungültig." : null);
  const hint =
    state === "loading"
      ? "IBAN wird geprüft…"
      : state === "valid" && bank
        ? `${bank}. BIC und Kreditinstitut wurden ergänzt.`
        : state === "valid"
          ? "IBAN ist gültig."
          : "Die IBAN finden Sie auf Ihrer Bankkarte oder im Online-Banking.";

  return (
    <Field
      label="IBAN *"
      anchorId="f-iban"
      error={localError}
      hint={hint}
      pulseNonce={pulseNonce}
      state={state === "valid" ? "valid" : "idle"}
    >
      <span className="relative block">
        <Input
          value={value}
          onChange={(e) => onChange(formatIban(e.target.value))}
          placeholder="DE12 3456 7890 1234 5678 90"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          className="pr-9"
        />
        <span aria-hidden className="-translate-y-1/2 absolute top-1/2 right-3 flex">
          {state === "loading" ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : state === "valid" ? (
            <CheckCircle2 className="motion-pop-in size-4 text-success" />
          ) : state === "invalid" ? (
            <XCircle className="motion-pop-in size-4 text-destructive" />
          ) : null}
        </span>
      </span>
    </Field>
  );
}
