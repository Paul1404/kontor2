import { useCallback, useEffect, useState } from "react";

export type RecentMember = {
  mitglnr: string;
  name: string;
  visitedAt: number;
};

const STORAGE_KEY = "svuwv.recentMembers";
const STORAGE_EVENT = "svuwv:recentMembers";
const MAX_RECENT = 6;

function readFromStorage(): RecentMember[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentMember[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r.mitglnr === "string" && typeof r.name === "string")
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
  push: (item: { mitglnr: string; name: string }) => void;
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

  const push = useCallback((item: { mitglnr: string; name: string }) => {
    if (!item.mitglnr) return;
    const current = readFromStorage();
    const filtered = current.filter((r) => r.mitglnr !== item.mitglnr);
    const next: RecentMember[] = [
      { mitglnr: item.mitglnr, name: item.name, visitedAt: Date.now() },
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
