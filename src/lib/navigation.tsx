import {
  AlertTriangle,
  BookOpen,
  Building2,
  ClipboardList,
  Coins,
  Database,
  FileBarChart,
  FileClock,
  FileLock2,
  FileSpreadsheet,
  FileWarning,
  History,
  Inbox,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  ListChecks,
  Lock,
  Mail,
  Mails,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import type { TenantPolicy } from "~/lib/tenant-settings";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  vorstandOnly?: boolean;
  capability?: "legacy-import" | "legacy-archive";
};

type NavSection = {
  label: string | null;
  items: NavItem[];
};

const LEGACY_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { to: "/app", label: "Übersicht", icon: <LayoutDashboard className="size-[18px]" /> },
      { to: "/app/mitglieder", label: "Mitglieder", icon: <Users className="size-[18px]" /> },
      {
        to: "/app/antraege",
        label: "Anträge",
        icon: <Inbox className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/familien",
        label: "Familien",
        icon: <UsersRound className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/wiedervorlagen",
        label: "Wiedervorlagen",
        icon: <ClipboardList className="size-[18px]" />,
        vorstandOnly: true,
      },
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
        to: "/app/zahlungsabgleich",
        label: "Zahlungsabgleich",
        icon: <Landmark className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/berichte",
        label: "Berichte",
        icon: <FileBarChart className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/rundschreiben",
        label: "Rundschreiben",
        icon: <Mails className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/datenqualitaet",
        label: "Datenqualität",
        icon: <ListChecks className="size-[18px]" />,
        vorstandOnly: true,
      },
      {
        to: "/app/audit",
        label: "Änderungsprotokoll",
        icon: <ScrollText className="size-[18px]" />,
      },
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
      {
        to: "/app/dokumentation",
        label: "Dokumentation",
        icon: <BookOpen className="size-[18px]" />,
        vorstandOnly: true,
      },
    ],
  },
  {
    label: "Verwaltung",
    items: [
      {
        to: "/app/import",
        label: "Datenimport",
        icon: <FileSpreadsheet className="size-[18px]" />,
        adminOnly: true,
        capability: "legacy-import",
      },
      {
        to: "/app/archive",
        label: "SQL-Archiv",
        icon: <Database className="size-[18px]" />,
        adminOnly: true,
        capability: "legacy-archive",
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
        label: "E-Mail",
        icon: <Mail className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/einstellungen/ki-zugriff",
        label: "KI-Zugriff",
        icon: <KeyRound className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/einstellungen/verschluesselung",
        label: "Verschlüsselung",
        icon: <Lock className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/admin/snapshots",
        label: "Snapshots",
        icon: <History className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/admin/protokoll",
        label: "Systemprotokoll",
        icon: <FileClock className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/admin/versandprotokoll",
        label: "Versandprotokoll",
        icon: <Mails className="size-[18px]" />,
        adminOnly: true,
      },
      {
        to: "/app/admin/sepa-pruefung",
        label: "SEPA-Prüfstand",
        icon: <ShieldCheck className="size-[18px]" />,
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

const items = LEGACY_SECTIONS.flatMap((s) => s.items);
const groups: Record<string, string[]> = {
  Mitglieder: ["/app/mitglieder", "/app/antraege", "/app/familien", "/app/wiedervorlagen"],
  Finanzen: ["/app/beitrag", "/app/forderungen", "/app/zahlungsabgleich"],
  Kommunikation: ["/app/rundschreiben", "/app/portal-anfragen"],
  Auswertungen: ["/app/berichte", "/app/audit"],
  Verwaltung: [
    "/app/datenqualitaet",
    "/app/dsgvo",
    "/app/dokumentation",
    "/app/einstellungen/verein",
    "/app/einstellungen/abteilungen",
    "/app/einstellungen/beitragsarten",
    "/app/einstellungen/benutzer",
  ],
  System: [
    "/app/einstellungen/smtp",
    "/app/einstellungen/ki-zugriff",
    "/app/einstellungen/verschluesselung",
    "/app/import",
    "/app/archive",
    "/app/admin/snapshots",
    "/app/admin/protokoll",
    "/app/admin/versandprotokoll",
    "/app/admin/sepa-pruefung",
    "/app/admin/erweitert",
  ],
};
export const NAV_SECTIONS: NavSection[] = [
  { label: null, items: items.filter((i) => i.to === "/app") },
  ...Object.entries(groups).map(([label, paths]) => ({
    label,
    items: paths.map((path) => items.find((i) => i.to === path)!),
  })),
];
export function navVisible(item: NavItem, role: string, policy: TenantPolicy): boolean {
  if (item.adminOnly && role !== "admin") return false;
  if (item.vorstandOnly && !["admin", "vorstand"].includes(role)) return false;
  if (item.capability === "legacy-import" && !policy.legacyImportSources.length) return false;
  if (item.capability === "legacy-archive" && !policy.legacyArchiveEnabled) return false;
  return true;
}
