import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  Coins,
  FileBarChart,
  FileSpreadsheet,
  History,
  Landmark,
  Layers,
  LayoutDashboard,
  Mail,
  ScrollText,
  Search,
  UserCog,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/cn";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";
import { useRecentMembers } from "~/lib/use-recent-members";

type Role = "admin" | "vorstand" | "readonly" | string;

type NavCommand = {
  kind: "nav";
  id: string;
  label: string;
  icon: ReactNode;
  path: string;
  needs: Role[];
};

const NAV_COMMANDS: NavCommand[] = [
  {
    kind: "nav",
    id: "dashboard",
    label: "Übersicht",
    icon: <LayoutDashboard className="size-4" />,
    path: "/app",
    needs: ["readonly", "vorstand", "admin"],
  },
  {
    kind: "nav",
    id: "members",
    label: "Mitglieder",
    icon: <Users className="size-4" />,
    path: "/app/mitglieder",
    needs: ["readonly", "vorstand", "admin"],
  },
  {
    kind: "nav",
    id: "members.new",
    label: "Neues Mitglied anlegen",
    icon: <Users className="size-4" />,
    path: "/app/mitglieder/neu",
    needs: ["vorstand", "admin"],
  },
  {
    kind: "nav",
    id: "fee-runs",
    label: "Beitragsläufe",
    icon: <Coins className="size-4" />,
    path: "/app/beitrag",
    needs: ["vorstand", "admin"],
  },
  {
    kind: "nav",
    id: "reports",
    label: "Berichte",
    icon: <FileBarChart className="size-4" />,
    path: "/app/berichte",
    needs: ["vorstand", "admin"],
  },
  {
    kind: "nav",
    id: "audit",
    label: "Änderungsprotokoll",
    icon: <ScrollText className="size-4" />,
    path: "/app/audit",
    needs: ["readonly", "vorstand", "admin"],
  },
  {
    kind: "nav",
    id: "snapshots",
    label: "Snapshots & Wiederherstellung",
    icon: <History className="size-4" />,
    path: "/app/admin/snapshots",
    needs: ["admin"],
  },
  {
    kind: "nav",
    id: "danger-zone",
    label: "Adminbereich (Gefahrenzone)",
    icon: <AlertTriangle className="size-4" />,
    path: "/app/admin/erweitert",
    needs: ["admin"],
  },
  {
    kind: "nav",
    id: "import",
    label: "Datenimport",
    icon: <FileSpreadsheet className="size-4" />,
    path: "/app/import",
    needs: ["admin"],
  },
  {
    kind: "nav",
    id: "verein",
    label: "Vereinsdaten",
    icon: <Building2 className="size-4" />,
    path: "/app/einstellungen/verein",
    needs: ["admin"],
  },
  {
    kind: "nav",
    id: "abteilungen",
    label: "Abteilungen",
    icon: <Layers className="size-4" />,
    path: "/app/einstellungen/abteilungen",
    needs: ["admin"],
  },
  {
    kind: "nav",
    id: "benutzer",
    label: "Benutzer",
    icon: <UserCog className="size-4" />,
    path: "/app/einstellungen/benutzer",
    needs: ["admin"],
  },
  {
    kind: "nav",
    id: "smtp",
    label: "SMTP",
    icon: <Mail className="size-4" />,
    path: "/app/einstellungen/smtp",
    needs: ["admin"],
  },
];

type MemberHit = {
  id: string;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  adrNr: number;
  vorname: string | null;
  nachname: string | null;
  ort: string | null;
};

export function CommandPalette({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { recent } = useRecentMembers();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setHighlight(0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const trimmed = query.trim();
  const memberSearch = useQuery({
    queryKey: ["members.quickSearch", trimmed],
    queryFn: () => orpc.members.quickSearch({ q: trimmed, limit: 8 }),
    enabled: open && trimmed.length >= 2,
    staleTime: 30_000,
  });
  const entitySearch = useQuery({
    queryKey: ["search.entities", trimmed],
    queryFn: () => orpc.search.entities({ q: trimmed, limit: 6 }),
    enabled: open && trimmed.length >= 2,
    staleTime: 30_000,
  });

  const filteredNav = useMemo(() => {
    const lowered = trimmed.toLowerCase();
    return NAV_COMMANDS.filter((cmd) => {
      if (!cmd.needs.includes(role)) return false;
      if (!lowered) return true;
      return cmd.label.toLowerCase().includes(lowered);
    });
  }, [trimmed, role]);

  const memberHits: MemberHit[] = (memberSearch.data?.rows as MemberHit[] | undefined) ?? [];
  const contractHits = entitySearch.data?.contracts ?? [];
  const mandateHits = entitySearch.data?.mandates ?? [];
  // A single action to jump into the full audit log filtered by the query.
  const auditActionCount = trimmed.length >= 2 ? 1 : 0;

  const navCount = filteredNav.length;
  const memberCount = memberHits.length;
  const contractCount = contractHits.length;
  const mandateCount = mandateHits.length;
  const recentCount = !trimmed ? Math.min(recent.length, 5) : 0;
  const total =
    navCount + memberCount + contractCount + mandateCount + auditActionCount + recentCount;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — reset highlight whenever the query changes, even though setHighlight isn't itself derived from trimmed.
  useEffect(() => {
    setHighlight(0);
  }, [trimmed]);

  // Keep the highlight in range when async results shrink the list, so Enter
  // never fires a stale index that now points at a different (or no) item.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, total - 1)));
  }, [total]);

  function executeAt(index: number) {
    let cursor = index;
    if (cursor < navCount) {
      const item = filteredNav[cursor];
      if (item) {
        setOpen(false);
        navigate({ to: item.path });
      }
      return;
    }
    cursor -= navCount;
    if (cursor < memberCount) {
      const hit = memberHits[cursor];
      if (hit) {
        setOpen(false);
        navigate({
          to: "/app/mitglieder/$mitgliedsnummer",
          params: { mitgliedsnummer: memberRef(hit) },
        });
      }
      return;
    }
    cursor -= memberCount;
    if (cursor < contractCount) {
      const hit = contractHits[cursor];
      if (hit) {
        setOpen(false);
        navigate({
          to: "/app/mitglieder/$mitgliedsnummer",
          params: { mitgliedsnummer: hit.reference },
        });
      }
      return;
    }
    cursor -= contractCount;
    if (cursor < mandateCount) {
      const hit = mandateHits[cursor];
      if (hit) {
        setOpen(false);
        navigate({
          to: "/app/mitglieder/$mitgliedsnummer",
          params: { mitgliedsnummer: hit.reference },
        });
      }
      return;
    }
    cursor -= mandateCount;
    if (cursor < auditActionCount) {
      setOpen(false);
      navigate({ to: "/app/audit", search: () => ({ q: trimmed }) as never });
      return;
    }
    cursor -= auditActionCount;
    if (cursor < recentCount) {
      const recentItem = recent[cursor];
      if (recentItem) {
        setOpen(false);
        navigate({
          to: "/app/mitglieder/$mitgliedsnummer",
          params: { mitgliedsnummer: recentItem.reference },
        });
      }
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (total === 0 ? 0 : (h + 1) % total));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (total === 0 ? 0 : (h - 1 + total) % total));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeAt(highlight);
    }
  }

  if (!open) return null;

  let runningIndex = 0;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismisses on click; keyboard users dismiss via Escape handled by the global keydown listener above.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Befehlspalette"
    >
      <div className="motion-zoom-in flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Mitglieder, Verträge, Mandate oder Seite suchen…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
          {total === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {memberSearch.isLoading || entitySearch.isLoading
                ? "Wird gesucht…"
                : "Keine Ergebnisse."}
            </p>
          ) : (
            <>
              {navCount > 0 ? (
                <Section label="Navigation">
                  {filteredNav.map((cmd) => {
                    const i = runningIndex++;
                    return (
                      <CommandItem
                        key={cmd.id}
                        icon={cmd.icon}
                        label={cmd.label}
                        active={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => executeAt(i)}
                      />
                    );
                  })}
                </Section>
              ) : null}
              {memberCount > 0 ? (
                <Section label="Mitglieder">
                  {memberHits.map((hit) => {
                    const i = runningIndex++;
                    const name =
                      [hit.vorname, hit.nachname].filter(Boolean).join(" ") || "Ohne Namen";
                    return (
                      <CommandItem
                        key={hit.id}
                        icon={<Users className="size-4" />}
                        label={name}
                        sublabel={`#${memberRef(hit)}${hit.ort ? ` · ${hit.ort}` : ""}`}
                        active={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => executeAt(i)}
                      />
                    );
                  })}
                </Section>
              ) : null}
              {contractCount > 0 ? (
                <Section label="Verträge">
                  {contractHits.map((hit) => {
                    const i = runningIndex++;
                    return (
                      <CommandItem
                        key={hit.id}
                        icon={<Coins className="size-4" />}
                        label={`Vertrag ${hit.vertragNr}${hit.artName ? ` · ${hit.artName}` : ""}`}
                        sublabel={`${hit.memberName} · #${hit.reference}`}
                        active={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => executeAt(i)}
                      />
                    );
                  })}
                </Section>
              ) : null}
              {mandateCount > 0 ? (
                <Section label="SEPA-Mandate">
                  {mandateHits.map((hit) => {
                    const i = runningIndex++;
                    return (
                      <CommandItem
                        key={hit.id}
                        icon={<Landmark className="size-4" />}
                        label={`Mandat ${hit.mandatsNr}`}
                        sublabel={`${hit.memberName} · #${hit.reference}`}
                        active={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => executeAt(i)}
                      />
                    );
                  })}
                </Section>
              ) : null}
              {auditActionCount > 0 ? (
                <Section label="Audit">
                  {(() => {
                    const i = runningIndex++;
                    return (
                      <CommandItem
                        icon={<ScrollText className="size-4" />}
                        label={`Im Änderungsprotokoll nach „${trimmed}" suchen`}
                        active={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => executeAt(i)}
                      />
                    );
                  })()}
                </Section>
              ) : null}
              {recentCount > 0 ? (
                <Section label="Zuletzt angesehen">
                  {recent.slice(0, recentCount).map((r) => {
                    const i = runningIndex++;
                    return (
                      <CommandItem
                        key={r.reference}
                        icon={<Users className="size-4" />}
                        label={r.name || `#${r.reference}`}
                        sublabel={`#${r.reference}`}
                        active={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => executeAt(i)}
                      />
                    );
                  })}
                </Section>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-muted px-1 py-0.5">↑↓</kbd> Navigieren ·{" "}
            <kbd className="rounded border border-border bg-muted px-1 py-0.5">↵</kbd> Öffnen
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted px-1 py-0.5">⌘K</kbd> zum Öffnen
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col py-1">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function CommandItem({
  icon,
  label,
  sublabel,
  active,
  onMouseEnter,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex flex-1 flex-col">
        <span>{label}</span>
        {sublabel ? <span className="text-xs text-muted-foreground">{sublabel}</span> : null}
      </span>
    </button>
  );
}
