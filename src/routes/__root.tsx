import {
  createRootRoute,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorPanel, NotFoundPanel } from "~/components/layout/ErrorPanel";
import { Toaster } from "~/components/ui/toaster";
import { type Branding, BrandingProvider } from "~/lib/branding";
import { brandColorCss } from "~/lib/branding-color";
import { isPublicProductRequest } from "~/lib/current-product-host";
import { orpc } from "~/lib/orpc";
import { isPublicProductPath } from "~/lib/product-host";
import { PRODUCT_DESCRIPTION, PRODUCT_SOCIAL_DESCRIPTION, PRODUCT_TITLE } from "~/lib/product-seo";
import { ThemeProvider, themeInitScript } from "~/lib/theme";
import appCss from "~/styles/globals.css?url";

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    // The apex is a public product site, never an accidental doorway into the
    // operator or a club realm. API handlers stay reachable for health checks.
    if (isPublicProductRequest() && !isPublicProductPath(location.pathname)) {
      throw redirect({ to: "/" });
    }
  },
  // Branding wird einmal serverseitig geladen und steht dem ganzen Baum (inkl.
  // Login/Setup) zur Verfügung. Resilient: ein Fehler darf die App nie
  // blockieren, dann gilt das Standard-Aussehen. Langer staleTime, damit
  // Client-Navigationen nicht neu laden.
  loader: async (): Promise<{ branding: Branding | null; isPublic: boolean }> => {
    if (isPublicProductRequest()) return { branding: null, isPublic: true };
    try {
      return { branding: await orpc.organization.branding(), isPublic: false };
    } catch {
      return { branding: null, isPublic: false };
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
    const isPublic = loaderData?.isPublic ?? false;
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
        {
          title: isPublic
            ? PRODUCT_TITLE
            : `${b?.anzeigename?.trim() || "Kontor2"}: Vereinsverwaltung`,
        },
        ...(isPublic
          ? [
              {
                name: "description",
                content: PRODUCT_DESCRIPTION,
              },
              { name: "robots", content: "index, follow, max-image-preview:large" },
              { property: "og:type", content: "website" },
              { property: "og:site_name", content: "Kontor2" },
              { property: "og:locale", content: "de_DE" },
              { property: "og:title", content: PRODUCT_TITLE },
              {
                property: "og:description",
                content: PRODUCT_SOCIAL_DESCRIPTION,
              },
              { property: "og:url", content: "https://kontor2.com/" },
              { property: "og:image", content: "https://kontor2.com/og.png" },
              { property: "og:image:type", content: "image/png" },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
              {
                property: "og:image:alt",
                content: "Kontor2: Vereinsverwaltung für den echten Verwaltungsalltag",
              },
              { name: "twitter:card", content: "summary_large_image" },
              { name: "twitter:title", content: PRODUCT_TITLE },
              { name: "twitter:description", content: PRODUCT_SOCIAL_DESCRIPTION },
              { name: "twitter:image", content: "https://kontor2.com/og.png" },
              {
                name: "twitter:image:alt",
                content: "Kontor2: Vereinssoftware für den echten Verwaltungsalltag",
              },
            ]
          : [{ name: "robots", content: "noindex, nofollow" }]),
        { name: "theme-color", content: b?.primaryColor || "#14223D" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        ...iconLinks,
        {
          rel: "manifest",
          href: isPublic ? "/manifest.webmanifest" : "/api/branding/manifest",
        },
        ...(isPublic
          ? [
              { rel: "alternate", hrefLang: "de", href: "https://kontor2.com/" },
              { rel: "alternate", hrefLang: "x-default", href: "https://kontor2.com/" },
            ]
          : []),
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
  // The club colour marks where the club appears: login, the member portal,
  // the application form, and the mail and letters rendered on the server. The
  // administration is a tool, not a shopfront, and keeps its own navy palette;
  // a saturated club colour on every primary button there fights the interface
  // instead of identifying the club.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isAdminSurface = pathname.startsWith("/app") || pathname.startsWith("/console");
  const brandCss = isAdminSurface ? "" : brandColorCss(branding?.primaryColor);
  return (
    <html lang="de" className="h-full" suppressHydrationWarning>
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
