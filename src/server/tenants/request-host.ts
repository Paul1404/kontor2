export function requestHost(headers: Headers): string | null {
  const host = headers.get("host")?.trim();
  if (host) return host;
  return headers.get("x-forwarded-host")?.split(",")[0]?.trim() || null;
}
