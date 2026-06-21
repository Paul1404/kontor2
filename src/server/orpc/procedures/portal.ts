import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { authBaseUrl } from "~/server/auth/auth";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { portalChangeRequestsTable, portalTokensTable } from "~/server/db/schema/portal";
import { EMAIL_KIND, recordEmail, statusFromSend } from "~/server/mail/email-log";
import { base, observability, vorstandProc } from "~/server/orpc/base";
import {
  buildPortalUrl,
  getPortalCookieFromHeaders,
  issuePortalToken,
  loadPortalMember,
  resolvePortalSession,
} from "~/server/portal/auth";
import { sendPortalInvite } from "~/server/portal/send-portal-invite";

/** Fields the portal allows a member to modify. Anything else is rejected. */
const EDITABLE_FIELDS = [
  "anrede",
  "vorname",
  "nachname",
  "strasse",
  "hausnummer",
  "plz",
  "ort",
  "land",
  "telefon1",
  "telefon2",
  "email",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

const portalProc = base.use(observability).use(
  base.middleware(async ({ context, next }) => {
    const cookie = getPortalCookieFromHeaders(context.headers);
    const session = await resolvePortalSession(context.db, cookie);
    if (!session) {
      throw new ORPCError("UNAUTHORIZED", { message: "Portal-Sitzung ungültig oder abgelaufen." });
    }
    return next({
      context: {
        ...context,
        portalSession: session,
      },
    });
  }),
);

// Cap each field so a member can't submit a megabyte of text for the Vorstand
// to review (and store). 200 chars is well above any real name/address line.
const shortText = v.optional(v.nullable(v.pipe(v.string(), v.maxLength(200))));
const ChangeRequestSchema = v.object({
  anrede: shortText,
  vorname: shortText,
  nachname: shortText,
  strasse: shortText,
  hausnummer: shortText,
  plz: shortText,
  ort: shortText,
  land: shortText,
  telefon1: shortText,
  telefon2: shortText,
  email: shortText,
});

function normalize(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const portalRouter = {
  /** Portal-side: who am I, what's my data? */
  me: base.handler(async ({ context }) => {
    const cookie = getPortalCookieFromHeaders(context.headers);
    const session = await resolvePortalSession(context.db, cookie);
    if (!session) return null;
    const member = await loadPortalMember(context.db, session.memberId);
    if (!member) return null;
    const [org] = await context.db
      .select({ vereinsname: organizationSettingsTable.vereinsname })
      .from(organizationSettingsTable)
      .limit(1);
    return {
      member,
      organization: { vereinsname: org?.vereinsname ?? "Verein" },
      pendingCount: await (async () => {
        const [row] = await context.db
          .select({ c: count() })
          .from(portalChangeRequestsTable)
          .where(
            and(
              eq(portalChangeRequestsTable.memberId, session.memberId),
              eq(portalChangeRequestsTable.status, "pending"),
            ),
          );
        return row?.c ?? 0;
      })(),
    };
  }),

  submitChanges: portalProc.input(ChangeRequestSchema).handler(async ({ context, input }) => {
    const { memberId, sessionId } = context.portalSession;

    const [member] = await context.db
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, memberId))
      .limit(1);
    if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

    const proposed: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in input) {
        proposed[field] = normalize(input[field]);
      }
    }

    const payload: Record<string, { before: unknown; after: unknown }> = {};
    for (const [key, value] of Object.entries(proposed)) {
      const before = (member as unknown as Record<string, unknown>)[key];
      const beforeNorm = typeof before === "string" ? normalize(before) : (before ?? null);
      if (beforeNorm === value) continue;
      payload[key] = { before: beforeNorm, after: value };
    }
    if (Object.keys(payload).length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "Keine Änderungen erkannt." });
    }

    const ipAddress = context.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    // Change request + its audit entry must be written together — a portal
    // submission without an audit row is a gap the Vorstand can't trace.
    const row = await context.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(portalChangeRequestsTable)
        .values({
          memberId,
          sessionId,
          payload,
          submittedIp: ipAddress,
        } as never)
        .returning({ id: portalChangeRequestsTable.id });

      await appendAudit(tx, {
        entityType: "portal_change_request",
        entityId: inserted!.id,
        action: "create",
        source: "system",
        actorId: null,
        actorEmail: member.email ?? null,
        changes: payload,
        requestId: context.requestId ?? null,
      });
      return inserted;
    });

    return { id: row!.id, fieldCount: Object.keys(payload).length };
  }),

  /** Admin side: issue a token + mail. */
  issueToken: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        ttlDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60)), 14),
        sendEmail: v.optional(v.boolean(), true),
        overrideEmail: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const [member] = await context.db
        .select({
          id: membersTable.id,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          kurzname: membersTable.kurzname,
          firma1: membersTable.firma1,
          email: membersTable.email,
        })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const targetEmail = input.overrideEmail?.trim() || member.email?.trim() || null;
      if (input.sendEmail && !targetEmail) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Keine E-Mail-Adresse hinterlegt. Bitte E-Mail eintragen oder Versand deaktivieren.",
        });
      }

      const { tokenId, rawToken, expiresAt } = await issuePortalToken(context.db, {
        memberId: member.id,
        sentToEmail: targetEmail,
        ttlDays: input.ttlDays,
        createdBy: context.session!.user.id,
      });

      const baseUrl = authBaseUrl(context.tenant);
      const portalUrl = buildPortalUrl(baseUrl, rawToken);

      let mailResult: { ok: true } | { ok: false; reason: string } = {
        ok: false,
        reason: "not_sent",
      };
      if (input.sendEmail && targetEmail) {
        const [org] = await context.db
          .select({ vereinsname: organizationSettingsTable.vereinsname })
          .from(organizationSettingsTable)
          .limit(1);
        const memberName =
          [member.vorname, member.nachname].filter(Boolean).join(" ") ||
          member.kurzname ||
          member.firma1 ||
          "Mitglied";
        mailResult = await sendPortalInvite({
          to: targetEmail,
          memberName,
          vereinsname: org?.vereinsname ?? "Verein",
          portalUrl,
          expiresAt,
        });
      }
      if (input.sendEmail) {
        await recordEmail(
          {
            kind: EMAIL_KIND.portalInvite,
            ...(targetEmail
              ? statusFromSend(mailResult)
              : { status: "skipped" as const, detail: "no_recipient" }),
            recipient: targetEmail,
            subject: "Zugang zum Mitgliederportal",
            entityType: "member",
            entityId: member.id,
            actorEmail: context.session!.user.email,
            requestId: context.requestId ?? null,
          },
          context.db,
        );
      }

      await appendAudit(context.db, {
        entityType: "portal_token",
        entityId: tokenId,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          memberId: { before: null, after: member.id },
          sentToEmail: { before: null, after: targetEmail },
          expiresAt: { before: null, after: expiresAt.toISOString() },
          mailDelivered: { before: null, after: mailResult.ok },
        },
        requestId: context.requestId ?? null,
      });

      return {
        tokenId,
        portalUrl,
        expiresAt,
        emailSent: mailResult.ok,
        emailReason: mailResult.ok ? null : mailResult.reason,
      };
    }),

  revokeToken: vorstandProc
    .input(v.object({ id: v.string(), reason: v.optional(v.nullable(v.string()), null) }))
    .handler(async ({ context, input }) => {
      const now = new Date();
      const updated = await context.db.transaction(async (tx) => {
        const [row] = await tx
          .update(portalTokensTable)
          .set({ revokedAt: now, revokedReason: input.reason })
          .where(eq(portalTokensTable.id, input.id))
          .returning({ id: portalTokensTable.id, memberId: portalTokensTable.memberId });
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Token nicht gefunden." });

        // Revoking portal access is a state change like every sibling
        // mutation — record it so the audit trail is complete.
        await appendAudit(tx, {
          entityType: "member",
          entityId: row.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            portalTokenRevoked: { before: null, after: input.reason ?? true },
          },
          requestId: context.requestId ?? null,
        });
        return row;
      });
      return { ok: true, memberId: updated.memberId };
    }),

  /** Admin side: list pending change requests for review. */
  listRequests: vorstandProc
    .input(
      v.optional(
        v.object({
          status: v.optional(
            v.nullable(v.picklist(["pending", "applied", "rejected", "partial"] as const)),
            null,
          ),
          page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
          pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const where = input.status ? eq(portalChangeRequestsTable.status, input.status) : undefined;
      const offset = (input.page - 1) * input.pageSize;
      const [rows, totals] = await Promise.all([
        context.db
          .select({
            id: portalChangeRequestsTable.id,
            memberId: portalChangeRequestsTable.memberId,
            submittedAt: portalChangeRequestsTable.submittedAt,
            submittedIp: portalChangeRequestsTable.submittedIp,
            payload: portalChangeRequestsTable.payload,
            status: portalChangeRequestsTable.status,
            reviewedAt: portalChangeRequestsTable.reviewedAt,
            reviewedBy: portalChangeRequestsTable.reviewedBy,
            reviewerNotes: portalChangeRequestsTable.reviewerNotes,
            memberNo: membersTable.memberNo,
            kontaktNo: membersTable.kontaktNo,
            mitgliedsnummer: membersTable.mitgliedsnummer,
            adrNr: membersTable.adrNr,
            vorname: membersTable.vorname,
            nachname: membersTable.nachname,
            kurzname: membersTable.kurzname,
            firma1: membersTable.firma1,
          })
          .from(portalChangeRequestsTable)
          .innerJoin(membersTable, eq(portalChangeRequestsTable.memberId, membersTable.id))
          .where(where)
          .orderBy(desc(portalChangeRequestsTable.submittedAt))
          .limit(input.pageSize)
          .offset(offset),
        context.db.select({ c: count() }).from(portalChangeRequestsTable).where(where),
      ]);
      return { rows, total: totals[0]?.c ?? 0 };
    }),

  reviewRequest: vorstandProc
    .input(
      v.object({
        id: v.string(),
        applyFields: v.array(v.picklist(EDITABLE_FIELDS)),
        rejectNotes: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const [req] = await context.db
        .select()
        .from(portalChangeRequestsTable)
        .where(eq(portalChangeRequestsTable.id, input.id))
        .limit(1);
      if (!req) throw new ORPCError("NOT_FOUND", { message: "Änderungsantrag nicht gefunden." });
      if (req.status !== "pending") {
        throw new ORPCError("CONFLICT", {
          message: `Dieser Antrag ist bereits bearbeitet (Status: ${req.status}).`,
        });
      }

      const payload = req.payload as Record<string, { before: unknown; after: unknown }>;
      const allKeys = Object.keys(payload).filter((k) =>
        EDITABLE_FIELDS.includes(k as EditableField),
      );
      // Dedupe: duplicate keys in applyFields would otherwise inflate the
      // applied count and miscompute the status (e.g. wrongly "partial").
      const applied = [...new Set(input.applyFields)].filter((k) => allKeys.includes(k));
      // Filled inside the transaction once we know the member's current values.
      const effectiveApplied: string[] = [];
      const staleSkipped: string[] = [];

      await context.db.transaction(async (tx) => {
        if (applied.length > 0) {
          // Re-read the member and apply only the fields that have NOT changed
          // since the request was submitted: optimistic concurrency. A field
          // whose current value no longer matches the value the member had at
          // submission (`payload[f].before`) was edited in the meantime, so
          // writing the request's stale `after` would silently lose that edit.
          // Such fields are skipped and reported back instead of overwritten.
          // Skip a member that was soft-deleted after the request was
          // submitted: writing change-request fields onto a deleted row would
          // silently resurrect stale data. memberBefore is then undefined and
          // nothing is applied (status falls through to rejected/partial).
          const [memberBefore] = await tx
            .select()
            .from(membersTable)
            .where(and(eq(membersTable.id, req.memberId), isNull(membersTable.deletedAt)))
            .limit(1);

          if (memberBefore) {
            const current = memberBefore as unknown as Record<string, unknown>;
            // Match submitChanges' normalize (trim, empty -> none) so a pure
            // whitespace difference is not mistaken for a real drift.
            const norm = (v: unknown) => (v == null ? "" : String(v).trim());
            const updates: Record<string, unknown> = {};
            for (const f of applied) {
              if (norm(current[f]) === norm(payload[f]?.before)) {
                updates[f] = payload[f]?.after ?? null;
                effectiveApplied.push(f);
              } else {
                staleSkipped.push(f);
              }
            }

            if (effectiveApplied.length > 0) {
              updates.updatedAt = new Date();
              const [memberAfter] = await tx
                .update(membersTable)
                .set(updates as never)
                .where(eq(membersTable.id, req.memberId))
                .returning();
              if (memberAfter) {
                await appendAudit(tx, {
                  entityType: "member",
                  entityId: req.memberId,
                  action: "update",
                  source: "ui",
                  actorId: context.session!.user.id,
                  actorEmail: context.session!.user.email,
                  changes: diff(current, memberAfter as unknown as Record<string, unknown>),
                  requestId: context.requestId ?? null,
                });
              }
            }
          }
        }

        // Status reflects what was actually applied. The admin rejecting all
        // fields is "rejected"; drift that left some fields unapplied is
        // "partial", not "applied".
        const nextStatus =
          applied.length === 0
            ? "rejected"
            : effectiveApplied.length === allKeys.length
              ? "applied"
              : "partial";

        await tx
          .update(portalChangeRequestsTable)
          .set({
            status: nextStatus,
            reviewedAt: new Date(),
            reviewedBy: context.session!.user.id,
            reviewerNotes: input.rejectNotes,
            appliedFields: effectiveApplied,
          })
          .where(eq(portalChangeRequestsTable.id, input.id));

        await appendAudit(tx, {
          entityType: "portal_change_request",
          entityId: input.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            status: { before: "pending", after: nextStatus },
            applied: { before: null, after: effectiveApplied.join(",") || null },
            ...(staleSkipped.length > 0
              ? { uebersprungen_geaendert: { before: null, after: staleSkipped.join(",") } }
              : {}),
          },
          requestId: context.requestId ?? null,
        });
      });

      const status =
        applied.length === 0
          ? "rejected"
          : effectiveApplied.length === allKeys.length
            ? "applied"
            : "partial";
      return { ok: true, applied: effectiveApplied, skipped: staleSkipped, status };
    }),

  listTokensForMember: vorstandProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      return context.db
        .select({
          id: portalTokensTable.id,
          sentToEmail: portalTokensTable.sentToEmail,
          expiresAt: portalTokensTable.expiresAt,
          consumedAt: portalTokensTable.consumedAt,
          revokedAt: portalTokensTable.revokedAt,
          createdAt: portalTokensTable.createdAt,
        })
        .from(portalTokensTable)
        .where(eq(portalTokensTable.memberId, input.memberId))
        .orderBy(desc(portalTokensTable.createdAt))
        .limit(20);
    }),
};
