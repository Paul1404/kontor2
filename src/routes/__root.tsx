import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorPanel, NotFoundPanel } from "~/components/layout/ErrorPanel";
import { Toaster } from "~/components/ui/toaster";
import { type Branding, BrandingProvider } from "~/lib/branding";
import { brandColorCss } from "~/lib/branding-color";
import { orpc } from "~/lib/orpc";
import { ThemeProvider, themeInitScript } from "~/lib/theme";
import appCss from "~/styles/globals.css?url";

export const Route = createRootRoute({
  // Branding wird einmal serverseitig geladen und steht dem ganzen Baum (inkl.
  // Login/Setup) zur Verfügung. Resilient: ein Fehler darf die App nie
  // blockieren, dann gilt das Standard-Aussehen. Langer staleTime, damit
  // Client-Navigationen nicht neu laden.
  loader: async (): Promise<{ branding: Branding | null }> => {
    try {
      return { branding: await orpc.organization.branding() };
    } catch {
      return { branding: null };
    }
  },
  staleTime: 5 * 60 * 1000,
  // Titel, theme-color, Favicons und Manifest laufen über die head()-API (von
  // <HeadContent/> serverseitig zuverlässig in den <head> gerendert) statt als
  // literales JSX in RootDocument -- letzteres hing am React-Head-Hoisting und
  // fiel für un-gebrandete Hosts (z. B. die Betreiber-Console) ganz aus.
  // Branding kommt aus den Loader-Daten: ein Verein mit eigenem Logo ersetzt das
  // Favicon, sonst gilt das gebündelte Kontor2-Zeichen.
  head: ({ loaderData }) => {
    const b = loaderData?.branding ?? null;
    // The browser favicon is part of the app chrome and stays Kontor², not the
    // Verein's logo. Per-Verein branding belongs on member-facing documents, not
    // the tab icon (otherwise the club looks like the software).
    const iconLinks = [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ];
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "color-scheme", content: "light dark" },
        { title: `${b?.anzeigename?.trim() || "Kontor2"}: Vereinsverwaltung` },
        { name: "theme-color", content: b?.primaryColor || "#14223D" },
      ],
      links: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Spectral:wght@500;600&display=swap",
        },
        { rel: "stylesheet", href: appCss },
        ...iconLinks,
        { rel: "manifest", href: "/api/branding/manifest" },
      ],
    };
  },
  component: RootRoute,
  // Last-resort safety net: any uncaught throw inside a route lands here
  // instead of TanStack's bare-bones default screen, which looks broken.
  errorComponent: ({ error, reset }) => (
    <RootDocument branding={null}>
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <ErrorPanel error={error} reset={reset} />
      </div>
    </RootDocument>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <NotFoundPanel />
    </div>
  ),
});

function RootRoute() {
  const { branding } = Route.useLoaderData();
  return (
    <RootDocument branding={branding}>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({
  branding,
  children,
}: {
  branding: Branding | null;
  children?: ReactNode;
}): ReactNode {
  const brandCss = brandColorCss(branding?.primaryColor);
  return (
    <html lang="de" className="h-full">
      <head>
        {/* Titel, theme-color, Favicons, Manifest kommen aus head() via HeadContent. */}
        <HeadContent />
        {brandCss ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, server-built from a validated hex
          <style dangerouslySetInnerHTML={{ __html: brandCss }} />
        ) : null}
        <script
          // Set theme class on <html> before React hydrates to avoid FOUC.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted constant
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="h-full bg-background text-foreground antialiased">
        <BrandingProvider value={branding}>
          <ThemeProvider>
            {children ?? <Outlet />}
            <Toaster />
          </ThemeProvider>
        </BrandingProvider>
        <Scripts />
      </body>
    </html>
  );
}
