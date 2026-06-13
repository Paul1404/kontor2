import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "~/server/db/types";

/**
 * Mandanten-Registry (Control-Plane). Lebt in der Control-DB -- vorerst die
 * Primär-/SVU-Datenbank (`DATABASE_URL`). Sie ist die elegante Endform der bis
 * dahin hand-gepflegten `TENANTS_JSON`-Env: jede Verein-DB wird hier als Zeile
 * bekannt gemacht, der Resolver liest sie (über einen In-Memory-Cache) statt aus
 * der Env. Backward-compatible: `TENANTS_JSON` bleibt als Fallback aktiv.
 *
 * WICHTIG: Der **primäre** Verein steht NICHT zwingend hier drin -- er kommt
 * immer synchron aus `DATABASE_URL` (`primaryTenant()`), damit der Request-Pfad
 * nie an dieser Tabelle hängt. Eine Zeile mit dem Primär-Schlüssel wird beim
 * Mergen ohnehin vom Primär überstimmt.
 *
 * `databaseUrl` enthält DB-Zugangsdaten und wird daher verschlüsselt abgelegt
 * (`encryptedText`); eine gelesene Zeile hält den Klartext.
 */
export const tenantsTable = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stabiler Schlüssel = linkes Subdomain-Label (`<key>.kontor2.com`). Eindeutig. */
    key: text("key").notNull(),
    /** Vollständige Postgres-Verbindung der Verein-DB. Verschlüsselt at rest. */
    databaseUrl: encryptedText("database_url").notNull(),
    /** Anzeigename für die Verwaltung (C4). Leer: es wird der Schlüssel gezeigt. */
    displayName: text("display_name"),
    /**
     * Lebenszyklus. Nur `active` wird vom Resolver bedient; `disabled` lässt einen
     * Verein bestehen, ohne dass seine Subdomain noch auflöst (Sperre statt Löschen).
     */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_key_unique").on(t.key)],
);

export type TenantRow = typeof tenantsTable.$inferSelect;
