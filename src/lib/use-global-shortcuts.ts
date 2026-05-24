import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

/**
 * Page-local shortcut: fires `handler` when a single key is pressed and
 * focus isn't in a text input. Use sparingly — global shortcuts in
 * `useGlobalShortcuts` should cover most cases.
 */
export function usePageShortcut(key: string, handler: (() => void) | null | undefined): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key !== key) return;
      if (!handlerRef.current) return;
      e.preventDefault();
      handlerRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);
}

/**
 * Global keyboard shortcuts. Skipped automatically when focus is in any
 * text-input-like element so admins typing into forms don't accidentally
 * trigger a navigation.
 *
 * Chord shortcuts (`g m`, `g d`, ...) follow the Linear / Gmail
 * convention: press `g`, then a second key within 1.2 s.
 *
 * Returns `{ openCheatsheet }` so consumers can mount their own help button.
 */
export type ShortcutContext = {
  role: string;
};

const CHORD_WINDOW_MS = 1_200;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(ctx: ShortcutContext): {
  cheatsheetOpen: boolean;
  setCheatsheetOpen: (open: boolean) => void;
} {
  const navigate = useNavigate();
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  // `g`-chord state. Refs (not state) so handlers don't re-bind every
  // keystroke and so the timeout reset is synchronous.
  const chordActive = useRef(false);
  const chordTimeout = useRef<number | null>(null);

  // Capture the latest ctx in a ref so the keydown handler is stable
  // across re-renders without depending on individual callbacks.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    function resetChord() {
      chordActive.current = false;
      if (chordTimeout.current !== null) {
        window.clearTimeout(chordTimeout.current);
        chordTimeout.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      // Never interfere with the system shortcuts the OS owns (copy/paste
      // etc.) or with the Cmd+K palette which has its own listener.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const k = e.key;
      const role = ctxRef.current.role;

      // Chord follow-up: a second key shortly after `g`.
      if (chordActive.current) {
        resetChord();
        // Routes with `validateSearch` (e.g. /app/mitglieder, /app/audit)
        // require an explicit search payload at the type level even when
        // empty — the validator fills in defaults. Cast keeps the
        // shortcut hook decoupled from each page's search shape.
        if (k === "m") {
          e.preventDefault();
          navigate({ to: "/app/mitglieder", search: () => ({}) as never });
          return;
        }
        if (k === "d") {
          e.preventDefault();
          navigate({ to: "/app" });
          return;
        }
        if (k === "a") {
          e.preventDefault();
          navigate({ to: "/app/audit", search: () => ({}) as never });
          return;
        }
        if (k === "b" && (role === "vorstand" || role === "admin")) {
          e.preventDefault();
          navigate({ to: "/app/beitrag" });
          return;
        }
        if (k === "s" && role === "admin") {
          e.preventDefault();
          navigate({ to: "/app/admin/snapshots" });
          return;
        }
        return;
      }

      if (k === "g") {
        chordActive.current = true;
        chordTimeout.current = window.setTimeout(resetChord, CHORD_WINDOW_MS);
        return;
      }
      if (k === "?") {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
        return;
      }
      if (k === "Escape" && cheatsheetOpen) {
        setCheatsheetOpen(false);
        return;
      }
      if (k === "/") {
        // Reach into the command palette via the same Cmd+K it listens for.
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      resetChord();
    };
  }, [navigate, cheatsheetOpen]);

  return { cheatsheetOpen, setCheatsheetOpen };
}
