/**
 * Shared helpers for handling an expired or missing session on the client.
 *
 * When any RPC call comes back UNAUTHORIZED mid-session, we don't want the
 * generic error boundary ("Etwas ist schiefgelaufen"). Instead we send the
 * user to the login page with a clear note and a way back to where they were.
 */

/** True when an error thrown by the oRPC client means "not signed in". */
export function isUnauthorizedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; status?: unknown };
  return e.code === "UNAUTHORIZED" || e.status === 401;
}

/**
 * Hard-redirect the browser to the login page, flagging the session as
 * expired and remembering the current location so login can return there.
 * No-op during SSR or when we're already on an auth page (avoids loops).
 */
export function redirectToLoginExpired(): void {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (path.startsWith("/login") || path.startsWith("/setup")) return;
  const params = new URLSearchParams({ expired: "1" });
  const here = window.location.pathname + window.location.search;
  if (here.startsWith("/app")) params.set("redirect", here);
  window.location.assign(`/login?${params.toString()}`);
}
