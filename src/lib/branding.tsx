import { createContext, type ReactNode, useContext } from "react";

/**
 * White-Label-Branding, das vom Root-Loader (öffentlicher branding-Endpunkt)
 * geladen und per Context durch die ganze App gereicht wird -- auch über die
 * Login- und Setup-Seiten, die vor der Anmeldung liegen. `useBranding` liefert
 * fertige Werte mit Rückfall auf das gebündelte Standard-Aussehen, solange
 * nichts konfiguriert ist.
 */
export type Branding = {
  anzeigename: string | null;
  logo: string | null;
  primaryColor: string | null;
  /** Cache-Buster-Hash des Logos für die Favicon-URL; null ohne Logo. */
  logoVersion: string | null;
};

const DEFAULT_BRANDING: Branding = {
  anzeigename: null,
  logo: null,
  primaryColor: null,
  logoVersion: null,
};

/**
 * URL des konfigurierten Logos als Favicon/App-Icon (vom Server skaliert), oder
 * null, wenn kein Logo gesetzt ist -- dann gilt das gebündelte Standard-Favicon.
 */
export function brandingIconUrl(b: Pick<Branding, "logo" | "logoVersion">): string | null {
  if (!b.logo) return null;
  return `/api/branding/icon?v=${b.logoVersion ?? "1"}`;
}

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({
  value,
  children,
}: {
  value: Branding | null | undefined;
  children: ReactNode;
}) {
  return (
    <BrandingContext.Provider value={value ?? DEFAULT_BRANDING}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): {
  /** Anzeigename für Kopfzeilen und Titel. */
  name: string;
  /** Logo-Quelle: konfiguriertes data-URI oder das gebündelte Standardlogo. */
  logoSrc: string;
  /** Konfigurierte Markenfarbe (Hex) oder null für das Standardrot. */
  primaryColor: string | null;
} {
  const b = useContext(BrandingContext);
  return {
    // Default: the Kontor2 product brand. A Verein white-labels on top by
    // setting its own Anzeigename / Logo in the settings.
    name: b.anzeigename?.trim() || "Kontor2",
    logoSrc: b.logo || "/logo.svg",
    primaryColor: b.primaryColor,
  };
}
