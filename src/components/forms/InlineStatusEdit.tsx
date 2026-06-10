import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "~/components/ui/badge";
import { toast } from "~/components/ui/toaster";
import { memberStatusView } from "~/lib/member-status";
import { orpc } from "~/lib/orpc";

type Member = {
  id: string;
  status: string | null;
  deletedAt: string | Date | null;
  austritt: string | Date | null;
  verstorbenAm: string | Date | null;
  /** Derived: holds an active membership in a real Abteilung. Drives the badge. */
  hatAktiveAbteilung: boolean;
};

/**
 * Inline Schnellbearbeitung in the member list: drop a live member into an
 * Abteilung without opening the detail page. aktiv vs passiv is derived from
 * the member's Abteilungen, so there is no manual toggle -- adding a real
 * Abteilung is what makes a member aktiv. Members that are deleted, ausgetreten
 * or verstorben stay a static badge; those transitions need dates and run
 * through their own dialogs.
 *
 * The menu renders in a portal with fixed positioning so the member table's
 * `overflow-x-auto` / `overflow-hidden` wrappers cannot clip it.
 */
export function InlineStatusEdit({
  member,
  canEdit,
  abteilungen,
  onChanged,
}: {
  member: Member;
  canEdit: boolean;
  abteilungen: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const live = member.status === "aktiv" || member.status === "passiv";
  const editable = canEdit && live && !member.deletedAt;

  const mutate = useMutation({
    mutationFn: (action: { type: "addAbteilung"; abteilungId: string }) =>
      orpc.members.bulk({ memberIds: [member.id], action }),
    onSuccess: (res) => {
      setOpen(false);
      if (res.changed > 0) {
        onChanged();
        toast.success("Aktualisiert");
      } else {
        toast.info("Keine Änderung");
      }
    },
    onError: (e: Error) => {
      setOpen(false);
      toast.error("Aktion fehlgeschlagen", { description: e.message });
    },
  });

  // Position the menu under the trigger; close it on any scroll/resize so it
  // never floats away from a row that moved.
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    }
    place();
    function onScrollOrResize() {
      setOpen(false);
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!editable) {
    return <StaticBadge member={member} />;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        title="Status schnell ändern"
      >
        <StaticBadge member={member} />
        {mutate.isPending ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3 text-muted-foreground" />
        )}
      </button>
      {open && pos
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Schließen"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setOpen(false)}
              />
              <div
                className="fixed z-50 w-52 rounded-lg border border-border bg-popover p-1 shadow-elevated"
                style={{ top: pos.top, left: pos.left }}
              >
                <div className="px-2 pb-1 pt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Abteilung hinzufügen
                </div>
                {abteilungen.length > 0 ? (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        mutate.mutate({ type: "addAbteilung", abteilungId: e.target.value });
                      }
                    }}
                    className="mx-1 mb-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-input bg-card px-2 text-sm"
                  >
                    <option value="">Auswählen…</option>
                    {abteilungen.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="px-2 pb-1.5 text-sm text-muted-foreground">
                    Keine Abteilungen angelegt.
                  </div>
                )}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

function StaticBadge({ member }: { member: Member }) {
  const view = memberStatusView(member);
  return <Badge variant={view.variant}>{view.label}</Badge>;
}
