/**
 * Menschliche Labels für die Rollen-Schlüssel. Die internen Schlüssel
 * (admin/vorstand/readonly) sind technisch -- in der Oberfläche zeigen wir
 * ausgeschriebene Begriffe.
 */
const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  vorstand: "Vorstand",
  readonly: "Lesezugriff",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}
