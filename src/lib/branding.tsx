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
};

const DEFAULT_BRANDING: Branding = { anzeigename: null, logo: null, primaryColor: null };

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
    name: b.anzeigename?.trim() || "Vereinsverwaltung",
    logoSrc: b.logo || "/logo.png",
    primaryColor: b.primaryColor,
  };
}
