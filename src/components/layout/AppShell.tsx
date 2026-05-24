import { Link, Outlet } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Sidebar } from "~/components/layout/Sidebar";
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
    <div className="flex h-screen">
      <Sidebar role={role} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between gap-4 border-b bg-card px-4">
          <div className="flex items-center gap-3 md:hidden">
            <img src="/favicon.svg" alt="SV Untereuerheim" className="size-7" />
            <Link to="/app" className="font-semibold tracking-tight">
              SVUWV
            </Link>
          </div>
          <div className="flex flex-1 justify-end items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {userEmail} <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{role}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => signOut().then(() => window.location.assign("/login"))}
            >
              <LogOut className="size-4" /> Abmelden
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6">{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
