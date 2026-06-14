import { useCallback, useEffect, useState } from "react";

export type RecentMember = {
  /** Canonical member reference (memberRef): the current number, not the legacy one. */
  reference: string;
  name: string;
  visitedAt: number;
};

const STORAGE_KEY = "kontor2.recentMembers";
const STORAGE_EVENT = "kontor2:recentMembers";
const MAX_RECENT = 6;

function readFromStorage(): RecentMember[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<RecentMember> & { mitgliedsnummer?: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => ({
        // Older entries stored the legacy number under `mitgliedsnummer`; read
        // it as the reference so existing history keeps working after the fix.
        reference: typeof r.reference === "string" ? r.reference : (r.mitgliedsnummer ?? ""),
        name: typeof r.name === "string" ? r.name : "",
        visitedAt: typeof r.visitedAt === "number" ? r.visitedAt : 0,
      }))
      .filter((r) => r.reference && r.name)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function writeToStorage(items: RecentMember[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    /* quota / disabled — silently ignore, the feature is non-essential */
  }
}

/**
 * Tiny localStorage-backed list of the last few member detail pages the
 * user has opened, surfaced in the sidebar and command palette. Synced
 * across components in the same tab via a CustomEvent, and across tabs
 * via the native `storage` event.
 */
export function useRecentMembers(): {
  recent: RecentMember[];
  push: (item: { reference: string; name: string }) => void;
  clear: () => void;
} {
  const [recent, setRecent] = useState<RecentMember[]>([]);

  useEffect(() => {
    setRecent(readFromStorage());
    function onUpdate() {
      setRecent(readFromStorage());
    }
    window.addEventListener(STORAGE_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const push = useCallback((item: { reference: string; name: string }) => {
    if (!item.reference) return;
    const current = readFromStorage();
    const filtered = current.filter((r) => r.reference !== item.reference);
    const next: RecentMember[] = [
      { reference: item.reference, name: item.name, visitedAt: Date.now() },
      ...filtered,
    ].slice(0, MAX_RECENT);
    writeToStorage(next);
    setRecent(next);
  }, []);

  const clear = useCallback(() => {
    writeToStorage([]);
    setRecent([]);
  }, []);

  return { recent, push, clear };
}
