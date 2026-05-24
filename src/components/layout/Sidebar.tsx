import { Link, useRouterState } from "@tanstack/react-router";
import {
  FileSpreadsheet,
  LayoutDashboard,
  Mail,
  ScrollText,
  ShieldCheck,
  UserCog,
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

type NavSection = {
  label: string | null;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { to: "/app", label: "Dashboard", icon: <LayoutDashboard className="size-[18px]" /> },
      { to: "/app/mitglieder", label: "Mitglieder", icon: <Users className="size-[18px]" /> },
      { to: "/app/audit", label: "Audit Log", icon: <ScrollText className="size-[18px]" /> },
    ],
  },
  {
    label: "Verwaltung",
    items: [
      {
        to: "/app/import",
        label: "Import",
        icon: <FileSpreadsheet className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/einstellungen/benutzer",
        label: "Benutzer",
        icon: <UserCog className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/einstellungen/smtp",
        label: "SMTP",
        icon: <Mail className="size-[18px]" />,
        adminOnly: true,
      },
    ],
  },
];

export function Sidebar({ role }: { role: string }) {
  const { location } = useRouterState();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-sidebar-border">
          <img src="/logo.png" alt="SV Untereuerheim" className="size-9 object-contain" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">SV Untereuerheim</span>
          <span className="text-[11px] uppercase tracking-wider text-sidebar-muted">Vereinsverwaltung</span>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-3 scrollbar-thin">
        {SECTIONS.map((sect, sIdx) => {
          const items = sect.items.filter((n) => !n.adminOnly || role === "admin");
          if (items.length === 0) return null;
          return (
            <div key={sect.label ?? `sec-${sIdx}`} className="flex flex-col gap-1">
              {sect.label ? (
                <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
                  {sect.label}
                </div>
              ) : null}
              {items.map((n) => {
                const active =
                  location.pathname === n.to || (n.to !== "/app" && location.pathname.startsWith(n.to));
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                      active
                        ? "bg-sidebar-accent text-sidebar-foreground shadow-soft"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-all",
                        active ? "bg-brand" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <span className={cn("transition-colors", active ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-foreground")}>
                      {n.icon}
                    </span>
                    {n.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/50 px-3 py-2 text-[11px] text-sidebar-muted">
          <ShieldCheck className="size-3.5 text-brand" />
          <span>Rolle: <span className="font-medium text-sidebar-foreground">{role}</span></span>
        </div>
      </div>
    </aside>
  );
}
