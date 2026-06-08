import { and, desc, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { auditLogTable } from "~/server/db/schema/audit";
import { dunningItemsTable, sepaReturnsTable } from "~/server/db/schema/dunning";
import { rundschreibenRecipientsTable, rundschreibenTable } from "~/server/db/schema/rundschreiben";
import { authedProc } from "~/server/orpc/base";

/**
 * A single, human-readable activity feed per member, merged from the records
 * that already exist: audit log, Mahnungen, Kulanz-Schreiben, Rundschreiben and
 * SEPA-Rückläufer. Pure reads, no new storage -- it just gives the scattered
 * history one chronological view on the member page.
 */

export type TimelineKind = "audit" | "dunning" | "kulanz" | "rundschreiben" | "sepa_return";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  at: string | Date;
  title: string;
  detail: string | null;
  actor: string | null;
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Angelegt",
  update: "Geändert",
  delete: "Gelöscht",
  restore: "Wiederhergestellt",
  dsgvo_export: "DSGVO-Auskunft erstellt",
  dsgvo_erasure: "DSGVO-Löschung",
  dsgvo_consent_change: "Einwilligung geändert",
};

const DUNNING_LEVEL_LABEL: Record<number, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

function fmtMoney(s: string | number | null): string {
  const n = typeof s === "number" ? s : Number.parseFloat(s ?? "0");
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export const timelineRouter = {
  forMember: authedProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const { memberId } = input;
      const [audit, dunning, kulanzRows, rundschreiben, returns] = await Promise.all([
        context.db
          .select({
            id: auditLogTable.id,
            createdAt: auditLogTable.createdAt,
            action: auditLogTable.action,
            actorEmail: auditLogTable.actorEmail,
            changes: auditLogTable.changes,
            source: auditLogTable.source,
          })
          .from(auditLogTable)
          .where(and(eq(auditLogTable.entityType, "member"), eq(auditLogTable.entityId, memberId)))
          .orderBy(desc(auditLogTable.createdAt))
          .limit(40),
        context.db
          .select({
            id: dunningItemsTable.id,
            createdAt: dunningItemsTable.createdAt,
            level: dunningItemsTable.level,
            docRef: dunningItemsTable.docRef,
            totalDue: dunningItemsTable.totalDue,
            sentChannel: dunningItemsTable.sentChannel,
          })
          .from(dunningItemsTable)
          .where(eq(dunningItemsTable.memberId, memberId))
          .orderBy(desc(dunningItemsTable.createdAt))
          .limit(30),
        context.db.execute<{ id: string; created_at: Date; doc_ref: string | null }>(sql`
          select id, created_at, doc_ref
          from kulanz_letters
          where exists (
            select 1 from jsonb_array_elements(recipients) e where e->>'memberId' = ${memberId}
          )
          order by created_at desc
          limit 20
        `),
        context.db
          .select({
            id: rundschreibenRecipientsTable.id,
            sentAt: rundschreibenRecipientsTable.sentAt,
            status: rundschreibenRecipientsTable.status,
            subject: rundschreibenTable.subject,
          })
          .from(rundschreibenRecipientsTable)
          .innerJoin(
            rundschreibenTable,
            eq(rundschreibenTable.id, rundschreibenRecipientsTable.rundschreibenId),
          )
          .where(eq(rundschreibenRecipientsTable.memberId, memberId))
          .orderBy(desc(rundschreibenRecipientsTable.sentAt))
          .limit(20),
        context.db
          .select({
            id: sepaReturnsTable.id,
            createdAt: sepaReturnsTable.createdAt,
            returnedOn: sepaReturnsTable.returnedOn,
            reasonCode: sepaReturnsTable.reasonCode,
            reasonText: sepaReturnsTable.reasonText,
          })
          .from(sepaReturnsTable)
          .where(eq(sepaReturnsTable.memberId, memberId))
          .orderBy(desc(sepaReturnsTable.createdAt))
          .limit(20),
      ]);

      const events: TimelineEvent[] = [];

      for (const a of audit) {
        const changed = a.changes && typeof a.changes === "object" ? Object.keys(a.changes) : [];
        const detail =
          a.action === "update" && changed.length > 0
            ? `${changed.length} ${changed.length === 1 ? "Feld" : "Felder"} geändert`
            : null;
        events.push({
          id: `audit-${a.id}`,
          kind: "audit",
          at: a.createdAt,
          title: AUDIT_ACTION_LABEL[a.action] ?? a.action,
          detail,
          actor: a.source === "import" ? "Import" : (a.actorEmail ?? null),
        });
      }

      for (const d of dunning) {
        const parts = [d.docRef, fmtMoney(d.totalDue)].filter(Boolean);
        events.push({
          id: `dunning-${d.id}`,
          kind: "dunning",
          at: d.createdAt,
          title: DUNNING_LEVEL_LABEL[d.level] ?? `Mahnstufe ${d.level}`,
          detail: parts.join(" · ") || null,
          actor: null,
        });
      }

      const kulanz = kulanzRows as unknown as Array<{
        id: string;
        created_at: Date;
        doc_ref: string | null;
      }>;
      for (const k of kulanz) {
        events.push({
          id: `kulanz-${k.id}`,
          kind: "kulanz",
          at: k.created_at,
          title: "Kulanz-Schreiben",
          detail: k.doc_ref ?? null,
          actor: null,
        });
      }

      for (const r of rundschreiben) {
        events.push({
          id: `rs-${r.id}`,
          kind: "rundschreiben",
          at: r.sentAt,
          title: "Rundschreiben",
          detail: r.status === "failed" ? `${r.subject} (fehlgeschlagen)` : r.subject,
          actor: null,
        });
      }

      for (const s of returns) {
        const parts = [s.reasonCode, s.reasonText].filter(Boolean);
        events.push({
          id: `ret-${s.id}`,
          kind: "sepa_return",
          at: s.createdAt,
          title: "SEPA-Rückläufer",
          detail: parts.join(" · ") || null,
          actor: null,
        });
      }

      events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      return events.slice(0, 60);
    }),
};
