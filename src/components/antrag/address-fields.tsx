import { Loader2, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc } from "~/lib/orpc";

/**
 * Address block for the public application form with directory-backed
 * autocomplete: street suggestions as you type and PLZ -> Ort resolution, from
 * the official OpenPLZ directory (Nominatim as fallback). Lookups are debounced
 * and best-effort; the plain inputs always work even if the service is down.
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
}: {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  onStrasse: (v: string) => void;
  onHausnummer: (v: string) => void;
  onPlz: (v: string) => void;
  onOrt: (v: string) => void;
}) {
  const [streetHits, setStreetHits] = useState<{ strasse: string; plz: string; ort: string }[]>([]);
  const [streetOpen, setStreetOpen] = useState(false);
  const [streetLoading, setStreetLoading] = useState(false);
  const streetPicked = useRef(false);

  const [plzOrte, setPlzOrte] = useState<string[]>([]);
  const [plzOpen, setPlzOpen] = useState(false);
  const lastPlz = useRef("");

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
      return;
    }
    setStreetLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await orpc.applications.searchStreets({ query: q, plz: plz || null });
        setStreetHits(res.results);
        setStreetOpen(res.results.length > 0);
      } catch {
        setStreetHits([]);
      } finally {
        setStreetLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [strasse, plz]);

  // PLZ -> Ort resolution once five digits are entered.
  useEffect(() => {
    const code = plz.trim();
    if (!/^\d{5}$/.test(code) || code === lastPlz.current) {
      if (!/^\d{5}$/.test(code)) {
        setPlzOrte([]);
        setPlzOpen(false);
      }
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await orpc.applications.lookupPlz({ plz: code });
        lastPlz.current = code;
        setPlzOrte(res.orte);
        if (res.orte.length === 1 && res.orte[0] && !ort.trim()) {
          onOrt(res.orte[0]);
        } else if (res.orte.length > 1 && !ort.trim()) {
          setPlzOpen(true);
        }
      } catch {
        setPlzOrte([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [plz, ort, onOrt]);

  function pickStreet(hit: { strasse: string; plz: string; ort: string }) {
    streetPicked.current = true;
    onStrasse(hit.strasse);
    if (hit.plz) {
      onPlz(hit.plz);
      lastPlz.current = hit.plz;
    }
    if (hit.ort) onOrt(hit.ort);
    setStreetOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="addr-strasse">Straße</Label>
          <div className="relative">
            <Input
              id="addr-strasse"
              value={strasse}
              autoComplete="off"
              onChange={(e) => onStrasse(e.target.value)}
              onFocus={() => streetHits.length > 0 && setStreetOpen(true)}
              onBlur={() => setTimeout(() => setStreetOpen(false), 150)}
            />
            {streetLoading ? (
              <Loader2 className="-translate-y-1/2 absolute top-1/2 right-3 size-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          {streetOpen ? (
            <ul className="motion-fade-in absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-elevated">
              {streetHits.map((hit) => (
                <li key={`${hit.strasse}-${hit.plz}-${hit.ort}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickStreet(hit)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {hit.strasse}
                      {hit.plz || hit.ort ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {`${hit.plz} ${hit.ort}`.trim()}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-hausnummer">Hausnummer</Label>
          <Input
            id="addr-hausnummer"
            value={hausnummer}
            onChange={(e) => onHausnummer(e.target.value)}
          />
        </div>

        <div className="relative flex flex-col gap-1.5">
          <Label htmlFor="addr-plz">PLZ</Label>
          <Input
            id="addr-plz"
            value={plz}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => onPlz(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onFocus={() => plzOrte.length > 1 && !ort.trim() && setPlzOpen(true)}
            onBlur={() => setTimeout(() => setPlzOpen(false), 150)}
          />
          {plzOpen && plzOrte.length > 1 ? (
            <ul className="motion-fade-in absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-elevated">
              {plzOrte.map((o) => (
                <li key={o}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onOrt(o);
                      setPlzOpen(false);
                    }}
                    className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {o}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="addr-ort">Ort</Label>
          <Input id="addr-ort" value={ort} onChange={(e) => onOrt(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Adressvorschläge kommen aus dem amtlichen Verzeichnis (OpenPLZ), ersatzweise aus
        OpenStreetMap. Beim Tippen wird die Eingabe zur Suche dorthin übermittelt.
      </p>
    </div>
  );
}
