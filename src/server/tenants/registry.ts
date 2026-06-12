/**
 * Mandanten-Registry: die eine Wahrheit, welche Vereine es gibt und auf welche
 * Datenbank jeder zeigt. Backup, Migration und (später) der Per-Request-DB-
 * Resolver teilen sich diese Liste -- so muss eine neue Verein-DB nur an EINER
 * Stelle bekannt gemacht werden.
 *
 * Heute: genau ein Mandant, "svu", auf der bestehenden DATABASE_URL. Die
 * laufende Instanz zieht NICHT um -- sie wird einfach als Mandant gelabelt.
 * Weitere Vereine kommen über die Env-Variable TENANTS_JSON dazu, z. B. eine
 * zweite Datenbank in derselben Postgres-Instanz:
 *
 *   TENANTS_JSON='[{"key":"verein_b","databaseUrl":"postgres://…/verein_b"}]'
 *
 * Bewusst abhängigkeitsfrei (nur process.env), damit das schlanke Backup-Skript
 * es ebenso nutzen kann wie der App-Code.
 */

export type Tenant = {
  /** Stabiler Schlüssel, z. B. "svu". Taucht in Dateinamen und (später) Subdomains auf. */
  key: string;
  databaseUrl: string;
};

export function listTenants(): Tenant[] {
  const tenants: Tenant[] = [];

  const primary = process.env.DATABASE_URL;
  if (primary) {
    tenants.push({ key: process.env.PRIMARY_TENANT_KEY ?? "svu", databaseUrl: primary });
  }

  const extra = process.env.TENANTS_JSON;
  if (extra?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extra);
    } catch (e) {
      throw new Error(`TENANTS_JSON ist kein gültiges JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error("TENANTS_JSON muss ein Array sein.");
    }
    for (const raw of parsed) {
      const t = raw as { key?: unknown; databaseUrl?: unknown };
      if (typeof t.key !== "string" || typeof t.databaseUrl !== "string") {
        throw new Error("Jeder TENANTS_JSON-Eintrag braucht 'key' und 'databaseUrl' (Strings).");
      }
      if (!tenants.some((x) => x.key === t.key)) {
        tenants.push({ key: t.key, databaseUrl: t.databaseUrl });
      }
    }
  }

  return tenants;
}

export function resolveTenant(key: string): Tenant {
  const found = listTenants().find((t) => t.key === key);
  if (!found) {
    const known = listTenants()
      .map((t) => t.key)
      .join(", ");
    throw new Error(`Unbekannter Mandant "${key}". Bekannt: ${known || "(keine)"}.`);
  }
  return found;
}
