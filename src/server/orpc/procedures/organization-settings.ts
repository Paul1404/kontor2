import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { normalizeHex } from "~/lib/branding-color";
import { appendAudit, diff } from "~/server/audit/log";
import { lastFour } from "~/server/crypto/encrypt";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { adminProc, authedProc, publicProc } from "~/server/orpc/base";
import { normalizeIban, validateIban } from "~/server/sepa/iban";

const MoneyString = v.pipe(v.string(), v.regex(/^-?\d+(\.\d{1,2})?$/));

/** Kurzer, stabiler Hash (djb2) für Cache-Busting des Logo-Icons. */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const BeitragsstaffelInput = v.object({
  familie: MoneyString,
  kind: MoneyString,
  kindElternMitglied: MoneyString,
  jugendlich: MoneyString,
  jugendlichElternMitglied: MoneyString,
  jungerErwachsener: MoneyString,
  erwachsener: MoneyString,
});

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
  mandatsreferenzPrefix: v.optional(v.pipe(v.string(), v.minLength(1)), "SVUWV-"),
  beitragsstaffel: v.optional(v.nullable(BeitragsstaffelInput), null),
  antragBenachrichtigungAktiv: v.optional(v.boolean(), true),
  antragVorstandEmail: v.optional(v.nullable(v.string()), null),
  /** PNG data URI, max ~512 KB encoded, or null to clear. */
  antragGegenzeichnungBild: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.regex(/^data:image\/(png|jpeg);base64,/, "Nur PNG- oder JPEG-Bilder erlaubt."),
        v.maxLength(700_000, "Bild zu groß (max. ca. 500 KB)."),
      ),
    ),
    null,
  ),
  antragGegenzeichnerName: v.optional(v.nullable(v.string()), null),
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

    const bic = input.vereinsBic.toUpperCase().replace(/\s+/g, "");
    // 8 or 11 chars: 6 letters (bank + country) + 2 alphanumeric (location) +
    // optional 3 alphanumeric (branch). A malformed BIC would otherwise land in
    // the pain.008 and be rejected by the bank on upload.
    if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
      throw new ORPCError("BAD_REQUEST", { message: "BIC ungültig (8 oder 11 Zeichen erwartet)." });
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
      vereinsBic: bic,
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
      mandatsreferenzPrefix: input.mandatsreferenzPrefix,
      beitragsstaffel: input.beitragsstaffel,
      antragBenachrichtigungAktiv: input.antragBenachrichtigungAktiv,
      antragVorstandEmail: input.antragVorstandEmail,
      antragGegenzeichnungBild: input.antragGegenzeichnungBild,
      antragGegenzeichnerName: input.antragGegenzeichnerName,
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
    // Replace the countersignature image with a presence marker so the audit
    // log keeps a "changed/cleared" signal without storing a 500 KB data URI.
    const mask = (v: string | null | undefined) => (v ? "[Bild gesetzt]" : null);
    const beforeForAudit = existing
      ? { ...existing, antragGegenzeichnungBild: mask(existing.antragGegenzeichnungBild) }
      : null;
    const nextForAudit = { ...next, antragGegenzeichnungBild: mask(next.antragGegenzeichnungBild) };

    await appendAudit(context.db, {
      entityType: "organization_settings",
      entityId: "1",
      action: existing ? "update" : "create",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: diff(beforeForAudit, nextForAudit),
      requestId: context.requestId ?? null,
    });

    return { ok: true };
  }),

  /**
   * White-Label-Branding für die gesamte Oberfläche. PUBLIC, weil Login und
   * Setup vor der Anmeldung Name, Logo und Farbe brauchen. Nichts Sensibles:
   * nur Anzeigename, Logo und Markenfarbe. Resilient -- bei fehlender Zeile
   * oder DB-Problem liefert es Defaults, damit die App nie an der Marke hängt.
   */
  branding: publicProc.handler(async ({ context }) => {
    try {
      const [row] = await context.db
        .select({
          vereinsname: organizationSettingsTable.vereinsname,
          anzeigename: organizationSettingsTable.anzeigename,
          logo: organizationSettingsTable.logo,
          primaryColor: organizationSettingsTable.primaryColor,
        })
        .from(organizationSettingsTable)
        .limit(1);
      return {
        anzeigename: row?.anzeigename?.trim() || row?.vereinsname?.trim() || null,
        logo: row?.logo || null,
        primaryColor: normalizeHex(row?.primaryColor),
        // Kurzer Hash des Logos als Cache-Buster für /api/branding/icon. Ändert
        // sich, sobald ein neues Logo gesetzt wird; null ohne Logo.
        logoVersion: row?.logo ? shortHash(row.logo) : null,
      };
    } catch {
      return { anzeigename: null, logo: null, primaryColor: null, logoVersion: null };
    }
  }),

  /**
   * Admin-only: setzt die Branding-Felder, ohne die SEPA-Pflichtfelder zu
   * verlangen. Setzt eine vorhandene Zeile voraus (zuerst Vereinsdaten
   * speichern). Logo als data-URI, Farbe als Hex.
   */
  updateBranding: adminProc
    .input(
      v.object({
        anzeigename: v.optional(v.nullable(v.string())),
        logo: v.optional(
          v.nullable(
            v.pipe(
              v.string(),
              v.startsWith("data:image/", "Logo muss ein Bild sein."),
              v.maxLength(700_000, "Logo zu groß (max. ca. 500 KB)."),
            ),
          ),
        ),
        primaryColor: v.optional(v.nullable(v.string())),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = (await context.db.select().from(organizationSettingsTable).limit(1))[0];
      if (!existing) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Bitte zuerst die Vereinsdaten speichern, dann das Branding anpassen.",
        });
      }
      const color =
        input.primaryColor === undefined
          ? existing.primaryColor
          : input.primaryColor === null || input.primaryColor.trim() === ""
            ? null
            : (normalizeHex(input.primaryColor) ??
              (() => {
                throw new ORPCError("BAD_REQUEST", {
                  message: "Farbe muss ein Hex sein, z. B. #1d4ed8.",
                });
              })());

      const next = {
        anzeigename:
          input.anzeigename === undefined
            ? existing.anzeigename
            : input.anzeigename?.trim() || null,
        logo: input.logo === undefined ? existing.logo : (input.logo ?? null),
        primaryColor: color,
        updatedAt: new Date(),
        updatedBy: context.session!.user.id,
      };
      await context.db.update(organizationSettingsTable).set(next as never);

      const mask = (v: string | null | undefined) => (v ? "[gesetzt]" : null);
      await appendAudit(context.db, {
        entityType: "organization_settings",
        entityId: "1",
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(
          {
            anzeigename: existing.anzeigename,
            logo: mask(existing.logo),
            primaryColor: existing.primaryColor,
          },
          { anzeigename: next.anzeigename, logo: mask(next.logo), primaryColor: next.primaryColor },
        ),
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),
};
