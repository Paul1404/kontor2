import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Keyboard, LogOut, Menu, Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { MobileSidebar, Sidebar } from "~/components/layout/Sidebar";
import { Button } from "~/components/ui/button";
import { CommandPalette } from "~/components/ui/command-palette";
import { KeyboardCheatsheet } from "~/components/ui/keyboard-cheatsheet";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { signOut } from "~/lib/auth-client";
import { useGlobalShortcuts } from "~/lib/use-global-shortcuts";

export function AppShell({
  role,
  userEmail,
  children,
}: {
  role: string;
  userEmail: string;
  children?: ReactNode;
}) {
  const { cheatsheetOpen, setCheatsheetOpen } = useGlobalShortcuts({ role });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Close the mobile drawer whenever the route changes (e.g. user taps a
  // link, hits browser back). Drawer auto-closes via onNavigate too, but
  // this catches programmatic navigations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger; the body intentionally only resets state.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);
  return (
    <div className="flex h-screen print:h-auto print:block print:bg-background">
      <Sidebar role={role} />
      <MobileSidebar role={role} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <main className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-border glass px-3 sm:px-4 md:px-6 print:hidden">
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent"
              aria-label="Menü öffnen"
              aria-expanded={mobileNavOpen}
            >
              <Menu className="size-5" />
            </button>
            <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
              <img src="/logo.png" alt="SV Untereuerheim" className="size-7 object-contain" />
            </div>
            <Link to="/app" className="text-sm font-semibold tracking-tight">
              SVUWV
            </Link>
          </div>
          <div className="flex flex-1 justify-end items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
              }
              className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent sm:hidden"
              aria-label="Suchen"
            >
              <Search className="size-5" />
            </button>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
              }
              className="hidden items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-soft hover:bg-accent hover:text-accent-foreground sm:flex"
              aria-label="Befehlspalette öffnen"
              title="Befehlspalette (⌘K)"
            >
              <Search className="size-3.5" />
              <span>Suchen</span>
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setCheatsheetOpen(true)}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:inline-flex"
              aria-label="Tastaturkürzel anzeigen"
              title="Tastaturkürzel (?)"
            >
              <Keyboard className="size-4" />
            </button>
            <ThemeToggle className="hidden sm:inline-flex" />
            <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 shadow-soft sm:flex">
              <span className="size-2 rounded-full bg-success" aria-hidden />
              <span className="text-xs text-muted-foreground">{userEmail}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                {role}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => signOut().then(() => window.location.assign("/login"))}
              aria-label="Abmelden"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Abmelden</span>
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-auto scrollbar-thin print:overflow-visible">
          <div className="mx-auto w-full max-w-7xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 md:p-8 print:max-w-none print:p-0">
            {children ?? <Outlet />}
          </div>
        </div>
      </main>
      <CommandPalette role={role} />
      <KeyboardCheatsheet open={cheatsheetOpen} onOpenChange={setCheatsheetOpen} role={role} />
    </div>
  );
}
