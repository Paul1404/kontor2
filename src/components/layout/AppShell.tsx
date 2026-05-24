import { Link, Outlet } from "@tanstack/react-router";
import { LogOut, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar } from "~/components/layout/Sidebar";
import { Button } from "~/components/ui/button";
import { CommandPalette } from "~/components/ui/command-palette";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { signOut } from "~/lib/auth-client";

export function AppShell({
  role,
  userEmail,
  children,
}: {
  role: string;
  userEmail: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-screen bg-background print:h-auto print:block">
      <Sidebar role={role} />
      <main className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border glass px-4 md:px-6 print:hidden">
          <div className="flex items-center gap-3 md:hidden">
            <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
              <img src="/logo.png" alt="SV Untereuerheim" className="size-7 object-contain" />
            </div>
            <Link to="/app" className="text-sm font-semibold tracking-tight">
              SVUWV
            </Link>
          </div>
          <div className="flex flex-1 justify-end items-center gap-3">
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
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Abmelden</span>
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-auto scrollbar-thin print:overflow-visible">
          <div className="mx-auto w-full max-w-7xl p-4 md:p-8 print:max-w-none print:p-0">
            {children ?? <Outlet />}
          </div>
        </div>
      </main>
      <CommandPalette role={role} />
    </div>
  );
}
