import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ReleaseNotesDialog } from "~/components/ui/release-notes-dialog";
import { cn } from "~/lib/cn";
import { CURRENT_VERSION, hasUnseenRelease } from "~/lib/release-notes";

type Variant = "sidebar" | "muted";

/**
 * Clickable version chip that opens the release-notes dialog. The unseen
 * indicator (red dot) is hydrated client-side only — `hasUnseenRelease`
 * touches `localStorage`, which is not available during SSR.
 */
export function VersionChip({
  variant = "sidebar",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const navigate = useNavigate();
  // Easter egg: seven rapid taps on the chip open the hidden schema museum.
  const taps = useRef<number[]>([]);

  function handleClick() {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length >= 7) {
      taps.current = [];
      void navigate({ to: "/app/museum" });
      return;
    }
    setOpen(true);
  }

  useEffect(() => {
    setUnseen(hasUnseenRelease());
  }, []);

  // Reset the unseen indicator when the dialog opens (the dialog also
  // writes the seen version to localStorage).
  useEffect(() => {
    if (open) setUnseen(false);
  }, [open]);

  const baseClasses =
    variant === "sidebar"
      ? "flex items-center gap-2 rounded-lg bg-sidebar-accent/50 px-3 py-2 text-[11px] text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      : "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(baseClasses, className)}
        aria-label="Versionshinweise öffnen"
      >
        <span className="font-mono tabular-nums">v{CURRENT_VERSION}</span>
        <span className="opacity-70">Versionshinweise</span>
        {unseen ? (
          <span
            role="status"
            aria-label="Neue Hinweise verfügbar"
            className="ml-auto inline-block size-1.5 rounded-full bg-brand"
          />
        ) : null}
      </button>
      <ReleaseNotesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
