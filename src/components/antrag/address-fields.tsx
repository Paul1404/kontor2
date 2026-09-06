import { Loader2, MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Field, fieldStateOf, Reveal } from "~/components/antrag/field";
import { Input } from "~/components/ui/input";
import {
  isComboboxNavKey,
  looksLikeHausnummer,
  moveActiveOption,
  splitMatch,
} from "~/lib/antrag-combobox";
import { validatePlzMessage } from "~/lib/application-validation";
import { cn } from "~/lib/cn";
import { orpc } from "~/lib/orpc";

type StreetHit = { strasse: string; plz: string; ort: string };
export type AddressFieldKey = "strasse" | "plz" | "ort";

/**
 * Address block for the public application form with directory-backed
 * autocomplete: street suggestions as you type (a keyboard-navigable combobox)
 * and PLZ -> Ort resolution from the official OpenPLZ directory (Nominatim as
 * fallback). Lookups are debounced and best-effort; the plain inputs always
 * work even if the service is down. Layout stays fixed while the applicant
 * types: suggestion lists float, status goes into the reserved helper line,
 * and the Ort choices for an ambiguous PLZ slide in below the Ort field.
 */
export function AddressFields({
  strasse,
  hausnummer,
  plz,
  ort,
  onStrasse,
  onHausnummer,
  onPlz,
  onOrt,
  errors,
  onBlurField,
  pulseNonce,
}: {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  onStrasse: (v: string) => void;
  onHausnummer: (v: string) => void;
  onPlz: (v: string) => void;
  onOrt: (v: string) => void;
  errors?: Partial<Record<AddressFieldKey, string>>;
  /** Called when a field loses focus so the parent can validate a filled value. */
  onBlurField?: (key: AddressFieldKey) => void;
  pulseNonce?: number;
}) {
  const listId = useId();
  const [streetHits, setStreetHits] = useState<StreetHit[]>([]);
  const [streetOpen, setStreetOpen] = useState(false);
  const [streetLoading, setStreetLoading] = useState(false);
  const [streetStatus, setStreetStatus] = useState<"idle" | "picked" | "none">("idle");
  const [active, setActive] = useState<number | null>(null);
  const streetPicked = useRef(false);
  // Suggestions only open while the applicant is actually in the street
  // field; a PLZ typed later must not pop the list open again.
  const streetFocused = useRef(false);
  const hausnummerRef = useRef<HTMLInputElement>(null);

  const [plzOrte, setPlzOrte] = useState<string[]>([]);
  const [plzLoading, setPlzLoading] = useState(false);
  const lastPlz = useRef("");
  // Latest Ort without re-running the PLZ effect when it changes.
  const ortRef = useRef(ort);
  ortRef.current = ort;

  // Street suggestions, debounced. Skip the lookup right after a pick so the
  // dropdown does not immediately reopen on the value we just set.
  useEffect(() => {
    if (streetPicked.current) {
      streetPicked.current = false;
      return;
    }
    const q = strasse.trim();
    if (q.length < 3) {
      setStreetHits([]);
      setStreetOpen(false);
      setStreetLoading(false);
      setStreetStatus("idle");
      return;
    }
    setStreetLoading(true);
    setStreetStatus("idle");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await orpc.applications.searchStreets({ query: q, plz: plz || null });
        if (cancelled) return;
        setStreetHits(res.results);
        setActive(null);
        setStreetOpen(res.results.length > 0 && streetFocused.current);
        setStreetStatus(res.results.length > 0 ? "idle" : "none");
      } catch {
        if (!cancelled) {
          setStreetHits([]);
          setStreetOpen(false);
        }
      } finally {
        if (!cancelled) setStreetLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [strasse, plz]);

  // PLZ -> Ort resolution once five digits are entered.
  useEffect(() => {
    const code = plz.trim();
    if (!/^\d{5}$/.test(code)) {
      setPlzOrte([]);
      setPlzLoading(false);
      return;
    }
    if (code === lastPlz.current) return;
    let cancelled = false;
    setPlzLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await orpc.applications.lookupPlz({ plz: code });
        if (cancelled) return;
        lastPlz.current = code;
        setPlzOrte(res.orte);
        const only = res.orte.length === 1 ? res.orte[0] : undefined;
        if (only && !ortRef.current.trim()) onOrt(only);
      } catch {
        if (!cancelled) setPlzOrte([]);
      } finally {
        if (!cancelled) setPlzLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [plz, onOrt]);

  // Keep the highlighted suggestion in view while arrowing through the list.
  useEffect(() => {
    if (active === null || !streetOpen) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, streetOpen, listId]);

  function pickStreet(hit: StreetHit) {
    streetPicked.current = true;
    onStrasse(hit.strasse);
    if (hit.plz) {
      onPlz(hit.plz);
      lastPlz.current = hit.plz;
      setPlzOrte([]);
    }
    if (hit.ort) onOrt(hit.ort);
    setStreetOpen(false);
    setActive(null);
    setStreetStatus("picked");
    hausnummerRef.current?.focus();
  }

  function onStreetKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const key = e.key;
    if (isComboboxNavKey(key)) {
      if (streetHits.length === 0) return;
      e.preventDefault();
      if (!streetOpen) setStreetOpen(true);
      setActive((cur) => moveActiveOption(cur, streetHits.length, key));
      return;
    }
    if (e.key === "Enter" && streetOpen && active !== null) {
      e.preventDefault();
      const hit = streetHits[active];
      if (hit) pickStreet(hit);
      return;
    }
    if (e.key === "Escape" && streetOpen) {
      e.preventDefault();
      setStreetOpen(false);
      setActive(null);
    }
  }

  const streetQuery = strasse.trim();
  const showOrtChoices = plzOrte.length > 1 && !plzOrte.includes(ort.trim());
  const streetHint = streetLoading
    ? "Suche im Straßenverzeichnis…"
    : streetStatus === "picked"
      ? "Aus dem Verzeichnis übernommen."
      : streetStatus === "none" && streetQuery.length >= 3
        ? "Kein Vorschlag gefunden. Die Eingabe wird so übernommen."
        : "Vorschläge erscheinen beim Tippen.";
  const plzHint = plzLoading
    ? "Ort wird ermittelt…"
    : plzOrte.length === 1
      ? "Ort wurde ergänzt."
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative sm:col-span-2">
          <Field
            label="Straße *"
            anchorId="f-strasse"
            error={errors?.strasse}
            hint={streetHint}
            pulseNonce={pulseNonce}
            state={fieldStateOf(strasse, strasse.trim().length >= 3, errors?.strasse)}
          >
            <span className="relative block">
              <Input
                value={strasse}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={streetOpen}
                aria-controls={listId}
                aria-activedescendant={
                  streetOpen && active !== null ? `${listId}-${active}` : undefined
                }
                onChange={(e) => onStrasse(e.target.value)}
                onKeyDown={onStreetKeyDown}
                onFocus={() => {
                  streetFocused.current = true;
                  if (streetHits.length > 0) setStreetOpen(true);
                }}
                onBlur={() => {
                  streetFocused.current = false;
                  setTimeout(() => setStreetOpen(false), 150);
                  onBlurField?.("strasse");
                }}
                className={cn(streetLoading && "pr-9")}
              />
              {streetLoading ? (
                <Loader2
                  aria-hidden
                  className="-translate-y-1/2 absolute top-1/2 right-3 size-4 animate-spin text-muted-foreground"
                />
              ) : null}
            </span>
          </Field>
          <div
            id={listId}
            role="listbox"
            aria-label="Straßenvorschläge"
            hidden={!streetOpen}
            className="motion-fade-in absolute top-16 left-0 z-20 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-elevated"
          >
            {streetHits.map((hit, i) => {
              const selected = active === i;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on the combobox input.
                <div
                  key={`${hit.strasse}-${hit.plz}-${hit.ort}`}
                  id={`${listId}-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pickStreet(hit)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                >
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">
                      {splitMatch(hit.strasse, streetQuery).map((seg, j) =>
                        seg.hit ? (
                          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                          <mark key={j} className="bg-transparent font-semibold text-foreground">
                            {seg.text}
                          </mark>
                        ) : (
                          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                          <span key={j}>{seg.text}</span>
                        ),
                      )}
                    </span>
                    {hit.plz || hit.ort ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {`${hit.plz} ${hit.ort}`.trim()}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <Field
          label="Hausnummer"
          hint="Zum Beispiel 12 oder 12a."
          state={fieldStateOf(hausnummer, looksLikeHausnummer(hausnummer))}
        >
          <Input
            ref={hausnummerRef}
            value={hausnummer}
            autoComplete="off"
            onChange={(e) => onHausnummer(e.target.value)}
          />
        </Field>

        <Field
          label="PLZ *"
          anchorId="f-plz"
          error={errors?.plz}
          hint={plzHint}
          pulseNonce={pulseNonce}
          state={fieldStateOf(plz, validatePlzMessage(plz) === null, errors?.plz)}
        >
          <span className="relative block">
            <Input
              value={plz}
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              onChange={(e) => onPlz(e.target.value.replace(/\D/g, "").slice(0, 5))}
              onBlur={() => onBlurField?.("plz")}
              className={cn(plzLoading && "pr-9")}
            />
            {plzLoading ? (
              <Loader2
                aria-hidden
                className="-translate-y-1/2 absolute top-1/2 right-3 size-4 animate-spin text-muted-foreground"
              />
            ) : null}
          </span>
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Ort *"
            anchorId="f-ort"
            error={errors?.ort}
            pulseNonce={pulseNonce}
            state={fieldStateOf(ort, ort.trim().length >= 2, errors?.ort)}
          >
            <Input
              value={ort}
              autoComplete="off"
              onChange={(e) => onOrt(e.target.value)}
              onBlur={() => onBlurField?.("ort")}
            />
          </Field>
          <Reveal open={showOrtChoices}>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs text-muted-foreground">Zu {plz} gehören:</span>
              {plzOrte.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => onOrt(o)}
                  className="motion-chip-in rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-all hover:border-ring/40 hover:bg-accent/60 active:scale-95"
                >
                  {o}
                </button>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Adressvorschläge kommen aus dem amtlichen Verzeichnis (OpenPLZ), ersatzweise aus
        OpenStreetMap. Beim Tippen wird die Eingabe zur Suche dorthin übermittelt.
      </p>
    </div>
  );
}
