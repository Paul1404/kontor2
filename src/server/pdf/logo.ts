import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Club logo as a base64 data URI for embedding in PDFs. Read once from disk
 * and cached for the process. Returns null if the asset can't be located so
 * PDF rendering still succeeds without it rather than throwing.
 *
 * The file lives in `public/` in dev and is copied to both `public/` and
 * `dist/client/` in the production image (see Dockerfile), so we try both
 * relative to the working directory.
 */
const CANDIDATES = ["public/logo.png", "dist/client/logo.png"] as const;

let cached: string | null | undefined;

export function clubLogoDataUri(): string | null {
  if (cached !== undefined) return cached;
  for (const rel of CANDIDATES) {
    const path = resolve(process.cwd(), rel);
    try {
      if (existsSync(path)) {
        const bytes = readFileSync(path);
        cached = `data:image/png;base64,${bytes.toString("base64")}`;
        return cached;
      }
    } catch {
      // Unreadable candidate -- fall through and try the next one.
    }
  }
  cached = null;
  return cached;
}
