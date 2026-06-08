import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { lastFour } from "~/server/crypto/encrypt";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { adminProc, authedProc } from "~/server/orpc/base";
import { normalizeIban, validateIban } from "~/server/sepa/iban";

const MoneyString = v.pipe(v.string(), v.regex(/^-?\d+(\.\d{1,2})?$/));

const UpdateInput = v.object({
  vereinsname: v.pipe(v.string(), v.minLength(1)),
  anschriftStrasse: v.optional(v.nullable(v.string()), null),
  anschriftPlz: v.optional(v.nullable(v.string()), null),
  anschriftOrt: v.optional(v.nullable(v.string()), null),
  anschriftLand: v.optional(v.string(), "DE"),
  glaeubigerId: v.pipe(v.string(), v.minLength(1)),
  vereinsIban: v.pipe(v.string(), v.minLength(15)),
  vereinsBic: v.pipe(v.string(), v.minLength(8)),
  vereinsBankname: v.optional(v.nullable(v.string()), null),
  defaultFalligkeitTag: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(28)),
  mahngebuhr1: v.optional(MoneyString, "0"),
  mahngebuhr2: v.optional(MoneyString, "5"),
  mahngebuhr3: v.optional(MoneyString, "10"),
  sepaReturnFee: v.optional(MoneyString, "3.00"),
  mahnFristTage: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)), 14),
  beitragModus: v.optional(v.picklist(["voll", "anteilig"]), "voll"),
  anteilEinheit: v.optional(v.picklist(["monat", "tag"]), "monat"),
  kuendigungsfristAktiv: v.optional(v.boolean(), false),
  kuendigungsfristTage: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365)),
    0,
  ),
  kuendigungZumMonatsende: v.optional(v.boolean(), false),
  kontaktEmail: v.optional(v.nullable(v.string()), null),
  mitgliedschaftEmail: v.optional(v.nullable(v.string()), null),
  kontaktTelefon: v.optional(v.nullable(v.string()), null),
  datenschutzUrl: v.optional(v.nullable(v.string()), null),
  satzungUrl: v.optional(v.nullable(v.string()), null),
});

export const organizationSettingsRouter = {
  /** Public-ish read for anyone authed: IBAN is masked to last 4. */
  get: authedProc.handler(async ({ context }) => {
    const rows = await context.db.select().from(organizationSettingsTable).limit(1);
    const row = rows[0];
    if (!row) return null;
    const { vereinsIban, ...rest } = row;
    return { ...rest, vereinsIbanMasked: `**** **** **** **** ${row.vereinsIbanLast4}` };
  }),

  /** Admin-only: returns full decrypted IBAN for edit form prefill. */
  getForEdit: adminProc.handler(async ({ context }) => {
    const rows = await context.db.select().from(organizationSettingsTable).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row, vereinsIban: row.vereinsIban };
  }),

  update: adminProc.input(UpdateInput).handler(async ({ context, input }) => {
    const iban = normalizeIban(input.vereinsIban);
    if (!validateIban(iban)) {
      throw new ORPCError("BAD_REQUEST", { message: "IBAN ungültig (Prüfsumme fehlerhaft)." });
    }

    const existing = (await context.db.select().from(organizationSettingsTable).limit(1))[0];

    const next = {
      vereinsname: input.vereinsname,
      anschriftStrasse: input.anschriftStrasse,
      anschriftPlz: input.anschriftPlz,
      anschriftOrt: input.anschriftOrt,
      anschriftLand: input.anschriftLand,
      glaeubigerId: input.glaeubigerId,
      vereinsIban: iban,
      vereinsIbanLast4: lastFour(iban)!,
      vereinsBic: input.vereinsBic.toUpperCase().replace(/\s+/g, ""),
      vereinsBankname: input.vereinsBankname,
      defaultFalligkeitTag: input.defaultFalligkeitTag,
      mahngebuhr1: input.mahngebuhr1,
      mahngebuhr2: input.mahngebuhr2,
      mahngebuhr3: input.mahngebuhr3,
      sepaReturnFee: input.sepaReturnFee,
      mahnFristTage: input.mahnFristTage,
      beitragModus: input.beitragModus,
      anteilEinheit: input.anteilEinheit,
      kuendigungsfristAktiv: input.kuendigungsfristAktiv,
      kuendigungsfristTage: input.kuendigungsfristTage,
      kuendigungZumMonatsende: input.kuendigungZumMonatsende,
      kontaktEmail: input.kontaktEmail,
      mitgliedschaftEmail: input.mitgliedschaftEmail,
      kontaktTelefon: input.kontaktTelefon,
      datenschutzUrl: input.datenschutzUrl,
      satzungUrl: input.satzungUrl,
      updatedAt: new Date(),
      updatedBy: context.session!.user.id,
    };

    if (!existing) {
      await context.db.insert(organizationSettingsTable).values({ id: 1, ...next } as never);
    } else {
      await context.db.update(organizationSettingsTable).set(next as never);
    }

    // `vereinsIban` is transparently decrypted by the `encryptedText` Drizzle
    // custom type, so `existing.vereinsIban` is already the plaintext IBAN.
    const beforeForAudit = existing ?? null;

    await appendAudit(context.db, {
      entityType: "organization_settings",
      entityId: "1",
      action: existing ? "update" : "create",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: diff(beforeForAudit, next),
      requestId: context.requestId ?? null,
    });

    return { ok: true };
  }),
};
