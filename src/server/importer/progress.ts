import { redis } from "~/server/redis/client";

/**
 * Live progress for a running import, published to Redis under a
 * client-supplied token so the browser can poll it while the upload request is
 * still in flight. The import itself is one long server request; without this
 * out-of-band channel the UI can only show an indeterminate spinner.
 */
export type ImportProgress = {
  phase: string;
  processed: number;
  total: number;
  percent: number;
  done: boolean;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

const KEY = (token: string) => `kontor2:import:progress:${token}`;
const TTL_SECONDS = 3600;
/** Don't hammer Redis on every row; coalesce writes to this cadence. */
const FLUSH_INTERVAL_MS = 250;

export type ProgressReporter = {
  report: (p: { phase: string; processed: number; total: number }) => void;
  finish: (opts?: { error?: string }) => Promise<void>;
};

/**
 * Build a reporter that throttles writes to Redis. `report` is fire-and-forget
 * (never blocks the import); `finish` forces a final flush of the terminal
 * state. A blank/whitespace token disables publishing entirely.
 */
export function createProgressReporter(token: string | undefined | null): ProgressReporter {
  const active = typeof token === "string" && token.trim().length > 0;
  const state: ImportProgress = {
    phase: "Vorbereiten",
    processed: 0,
    total: 0,
    percent: 0,
    done: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  let lastFlush = 0;

  const flush = async (): Promise<void> => {
    if (!active) return;
    state.updatedAt = Date.now();
    try {
      await redis().set(KEY(token as string), JSON.stringify(state), "EX", TTL_SECONDS);
    } catch {
      /* progress is best-effort; never fail the import over Redis */
    }
  };

  return {
    report({ phase, processed, total }) {
      state.phase = phase;
      state.processed = processed;
      state.total = total;
      state.percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
      const now = Date.now();
      if (now - lastFlush < FLUSH_INTERVAL_MS) return;
      lastFlush = now;
      void flush();
    },
    async finish(opts) {
      state.done = true;
      if (opts?.error) {
        state.error = opts.error;
      } else {
        state.percent = 100;
      }
      lastFlush = Date.now();
      await flush();
    },
  };
}

export async function readImportProgress(token: string): Promise<ImportProgress | null> {
  try {
    const raw = await redis().get(KEY(token));
    return raw ? (JSON.parse(raw) as ImportProgress) : null;
  } catch {
    return null;
  }
}
