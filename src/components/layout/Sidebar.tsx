import { Link, useRouterState } from "@tanstack/react-router";
import {
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { to: "/app/mitglieder", label: "Mitglieder", icon: <Users className="size-4" /> },
  { to: "/app/audit", label: "Audit Log", icon: <ScrollText className="size-4" /> },
  { to: "/app/import", label: "Import", icon: <FileSpreadsheet className="size-4" />, adminOnly: true },
  { to: "/app/einstellungen/benutzer", label: "Benutzer", icon: <ClipboardList className="size-4" />, adminOnly: true },
  { to: "/app/einstellungen/smtp", label: "SMTP", icon: <Settings className="size-4" />, adminOnly: true },
];

export function Sidebar({ role }: { role: string }) {
  const { location } = useRouterState();
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <img src="/favicon.svg" alt="SV Untereuerheim" className="size-7" />
        <span className="font-semibold tracking-tight">SVUWV</span>
      </div>
      <nav className="p-3">
        {NAV.filter((n) => !n.adminOnly || role === "admin").map((n) => {
          const active =
            location.pathname === n.to || (n.to !== "/app" && location.pathname.startsWith(n.to));
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {n.icon}
              {n.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
