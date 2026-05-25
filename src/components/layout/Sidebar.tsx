import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  Clock,
  Coins,
  FileBarChart,
  FileLock2,
  FileSpreadsheet,
  FileWarning,
  History,
  Inbox,
  Layers,
  LayoutDashboard,
  Mail,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { VersionChip } from "~/components/ui/version-chip";
import { cn } from "~/lib/cn";
import { useRecentMembers } from "~/lib/use-recent-members";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  vorstandOnly?: boolean;
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
      {
        to: "/app/beitrag",
        label: "Beitragsläufe",
        icon: <Coins className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/forderungen",
        label: "Forderungen",
        icon: <FileWarning className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/berichte",
        label: "Berichte",
        icon: <FileBarChart className="size-[18px]" />,
        vorstandOnly: true,
      },
      { to: "/app/audit", label: "Audit Log", icon: <ScrollText className="size-[18px]" /> },
      {
        to: "/app/dsgvo",
        label: "Datenschutz",
        icon: <FileLock2 className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/portal-anfragen",
        label: "Portal-Anfragen",
        icon: <Inbox className="size-[18px]" />,
        vorstandOnly: true,
      },
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
        to: "/app/einstellungen/verein",
        label: "Vereinsdaten",
        icon: <Building2 className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/einstellungen/abteilungen",
        label: "Abteilungen",
        icon: <Layers className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/einstellungen/beitragsarten",
        label: "Beitragsarten",
        icon: <Coins className="size-[18px]" />,
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
      {
        to: "/app/admin/snapshots",
        label: "Snapshots",
        icon: <History className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/admin/erweitert",
        label: "Adminbereich",
        icon: <AlertTriangle className="size-[18px]" />,
        adminOnly: true,
      },
    ],
  },
];

function SidebarBody({
  role,
  onNavigate,
  showCloseButton,
  onClose,
}: {
  role: string;
  onNavigate?: () => void;
  showCloseButton?: boolean;
  onClose?: () => void;
}) {
  const { location } = useRouterState();
  const { recent } = useRecentMembers();
  return (
    <>
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft ring-1 ring-sidebar-border">
          <img src="/logo.png" alt="SV Untereuerheim" className="size-9 object-contain" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">SV Untereuerheim</span>
          <span className="text-[11px] uppercase tracking-wider text-sidebar-muted">
            Vereinsverwaltung
          </span>
        </div>
        {showCloseButton ? (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto -mr-1 inline-flex size-9 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Menü schließen"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </div>
      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-3 scrollbar-thin">
        {SECTIONS.map((sect, sIdx) => {
          const items = sect.items.filter((n) => {
            if (n.adminOnly && role !== "admin") return false;
            if (n.vorstandOnly && role !== "admin" && role !== "vorstand") return false;
            return true;
          });
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
                  location.pathname === n.to ||
                  (n.to !== "/app" && location.pathname.startsWith(n.to));
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
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
                    <span
                      className={cn(
                        "transition-colors",
                        active
                          ? "text-brand"
                          : "text-sidebar-muted group-hover:text-sidebar-foreground",
                      )}
                    >
                      {n.icon}
                    </span>
                    {n.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
        {recent.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="mb-1 flex items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
              <Clock className="size-3" />
              Zuletzt angesehen
            </div>
            {recent.slice(0, 5).map((r) => (
              <Link
                key={r.mitglnr}
                to="/app/mitglieder/$mitgliedsnummer"
                params={{ mitgliedsnummer: r.mitglnr }}
                onClick={onNavigate}
                className="group flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                title={r.name}
              >
                <span className="truncate">{r.name || `#${r.mitglnr}`}</span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-sidebar-muted">
                  #{r.mitglnr}
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </nav>
      <div className="flex flex-col gap-1.5 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/50 px-3 py-2 text-[11px] text-sidebar-muted">
          <ShieldCheck className="size-3.5 text-brand" />
          <span>
            Rolle: <span className="font-medium text-sidebar-foreground">{role}</span>
          </span>
        </div>
        <VersionChip />
      </div>
    </>
  );
}

export function Sidebar({ role }: { role: string }) {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden md:flex">
      <SidebarBody role={role} />
    </aside>
  );
}

export function MobileSidebar({
  role,
  open,
  onClose,
}: {
  role: string;
  open: boolean;
  onClose: () => void;
}) {
  // Lock body scroll while the drawer is open so the underlying page
  // doesn't move when the user scrolls the nav.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden print:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Menü schließen"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Hauptmenü"
        className={cn(
          "absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-elevated transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarBody role={role} showCloseButton onClose={onClose} onNavigate={onClose} />
      </aside>
    </div>
  );
}
