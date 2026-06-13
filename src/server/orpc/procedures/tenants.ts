import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { tenantsTable } from "~/server/db/schema/tenants";
import { env } from "~/server/env";
import { authedProc, superAdminProc } from "~/server/orpc/base";
import {
  DB_NAME_RE,
  deprovisionTenant,
  provisionTenant,
  TENANT_KEY_RE,
} from "~/server/tenants/provision";
import { invalidateTenantCache } from "~/server/tenants/registry";
import { primaryTenant, productDomain } from "~/server/tenants/resolve";

/**
 * Control-Plane: Vereine listen, anlegen, sperren/entsperren, entfernen. Alles
 * `superAdminProc` (Admin des Primär-Vereins). Schreiboperationen invalidieren
 * den Resolver-Cache, damit eine Änderung sofort greift (statt erst nach TTL).
 *
 * Der Primär-Verein steht nicht in der Tabelle (er kommt aus DATABASE_URL); er
 * wird in `list` synthetisch oben angehängt und ist nicht veränderbar.
 */
export const tenantsRouter = {
  /** Nav-Gating: darf der aktuelle Nutzer Vereine verwalten? (Admin + Primär-Host) */
  canManage: authedProc.input(v.void()).handler(async ({ context }) => {
    return context.session?.user.role === "admin" && context.tenant.key === primaryTenant().key;
  }),

  list: superAdminProc.input(v.void()).handler(async ({ context }) => {
    const primary = primaryTenant();
    const rows = await context.db
      .select({
        key: tenantsTable.key,
        databaseName: tenantsTable.databaseName,
        displayName: tenantsTable.displayName,
        status: tenantsTable.status,
        createdAt: tenantsTable.createdAt,
      })
      .from(tenantsTable)
      .orderBy(tenantsTable.key);
    return {
      productDomain: productDomain(),
      primaryKey: primary.key,
      tenants: rows.filter((r) => r.key !== primary.key),
    };
  }),

  create: superAdminProc
    .input(
      v.object({
        key: v.pipe(v.string(), v.trim(), v.maxLength(40)),
        displayName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
        databaseName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
      }),
    )
    .handler(async ({ context, input }) => {
      const key = input.key.toLowerCase();
      const databaseName = (input.databaseName?.toLowerCase() || key).replaceAll("-", "_");
      if (!TENANT_KEY_RE.test(key)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Schlüssel erlaubt nur a-z, 0-9 und '-' (nicht am Rand).",
        });
      }
      if (!DB_NAME_RE.test(databaseName)) {
        throw new ORPCError("BAD_REQUEST", { message: "DB-Name erlaubt nur a-z, 0-9 und '_'." });
      }
      if (key === primaryTenant().key) {
        throw new ORPCError("BAD_REQUEST", { message: "Das ist der Hauptverein." });
      }
      const [existing] = await context.db
        .select({ key: tenantsTable.key })
        .from(tenantsTable)
        .where(eq(tenantsTable.key, key))
        .limit(1);
      if (existing) {
        throw new ORPCError("CONFLICT", { message: `Verein "${key}" existiert bereits.` });
      }

      // Legt DB an, migriert sie und schreibt die tenants-Zeile. In-App: die
      // interne DATABASE_URL erreicht die Postgres-Instanz, der User ist Superuser.
      await provisionTenant(env().DATABASE_URL, {
        key,
        displayName: input.displayName,
        databaseName,
        primaryKey: primaryTenant().key,
      });
      invalidateTenantCache();
      await appendAudit(context.db, {
        entityType: "tenant",
        entityId: key,
        action: "create",
        source: "ui",
        actorId: context.session?.user.id ?? null,
        actorEmail: context.session?.user.email ?? null,
        changes: {
          key: { before: null, after: key },
          databaseName: { before: null, after: databaseName },
        },
        requestId: context.requestId,
      });
      return { key, databaseName };
    }),

  setStatus: superAdminProc
    .input(v.object({ key: v.string(), status: v.picklist(["active", "disabled"]) }))
    .handler(async ({ context, input }) => {
      if (input.key === primaryTenant().key) {
        throw new ORPCError("BAD_REQUEST", { message: "Der Hauptverein ist nicht sperrbar." });
      }
      const [row] = await context.db
        .update(tenantsTable)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(tenantsTable.key, input.key))
        .returning({ key: tenantsTable.key });
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Verein nicht gefunden." });
      invalidateTenantCache();
      await appendAudit(context.db, {
        entityType: "tenant",
        entityId: input.key,
        action: "update",
        source: "ui",
        actorId: context.session?.user.id ?? null,
        actorEmail: context.session?.user.email ?? null,
        changes: { status: { before: null, after: input.status } },
        requestId: context.requestId,
      });
      return { key: input.key, status: input.status };
    }),

  /** Entfernt einen Verein vollständig: tenants-Zeile UND die Datenbank (DROP). */
  remove: superAdminProc
    .input(v.object({ key: v.string(), confirmKey: v.string() }))
    .handler(async ({ context, input }) => {
      if (input.key === primaryTenant().key) {
        throw new ORPCError("BAD_REQUEST", { message: "Der Hauptverein ist nicht löschbar." });
      }
      if (input.confirmKey !== input.key) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Bestätigung stimmt nicht mit dem Schlüssel überein.",
        });
      }
      const [row] = await context.db
        .select({ databaseName: tenantsTable.databaseName })
        .from(tenantsTable)
        .where(eq(tenantsTable.key, input.key))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Verein nicht gefunden." });

      await deprovisionTenant(env().DATABASE_URL, {
        key: input.key,
        databaseName: row.databaseName ?? input.key,
      });
      invalidateTenantCache();
      await appendAudit(context.db, {
        entityType: "tenant",
        entityId: input.key,
        action: "delete",
        source: "ui",
        actorId: context.session?.user.id ?? null,
        actorEmail: context.session?.user.email ?? null,
        changes: { key: { before: input.key, after: null } },
        requestId: context.requestId,
      });
      return { key: input.key };
    }),
};
