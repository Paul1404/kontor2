/**
 * Best-effort client IP for rate-limit keying. Behind Railway's TLS-terminating
 * proxy the real visitor address arrives in `x-forwarded-for` (a comma-joined
 * list, client first). Falls back to a constant bucket when the header is
 * absent so a missing header degrades to a shared limit rather than no limit.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
