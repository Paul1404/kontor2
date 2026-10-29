import { call } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applicationFeeSettings } from "~/lib/application-fee-schedule";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable as orgTable } from "~/server/db/schema/organization-settings";
import { resolveApplicationFee } from "~/server/domain/application/resolve-fee";
import { onboardMember } from "~/server/domain/member/onboard";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

const old = {
  familie: "96",
  kind: "24",
  kindElternMitglied: "12",
  jugendlich: "36",
  jugendlichElternMitglied: "24",
  jungerErwachsener: "42",
  erwachsener: "54",
};
const schedule = {
  effectiveFrom: "2027-01-01",
  staffel: { ...old, erwachsener: "60", jungerErwachsener: "45", familie: "100" },
  altersgrenzen: { kindMax: 14, jugendlichMax: 18, jungerErwachsenerMax: 27 },
  feeTypes: { erwachsener: 940200, junger_erwachsener: 940204 },
};
const ctx = (): AppContext => ({
  db: db(),
  tenant: { key: "schedule-test", databaseUrl: "" },
  session: null,
  headers: new Headers({ "x-forwarded-for": "192.0.2.229" }),
  requestId: "schedule-test",
});
let previous: typeof orgTable.$inferSelect | undefined;
describe.skipIf(!process.env.DATABASE_URL?.includes("svuwv_test"))(
  "application tariff rollover",
  () => {
    beforeAll(async () => {
      await db()
        .insert(users)
        .values({
          id: "schedule-actor",
          name: "Schedule Test",
          email: "schedule-actor@example.test",
          role: "admin",
        })
        .onConflictDoNothing();
      [previous] = await db().select().from(orgTable).limit(1);
      await db()
        .delete(feeTypesTable)
        .where(inArray(feeTypesTable.art, [940200, 940201, 940202, 940204]));
      await db()
        .insert(feeTypesTable)
        .values([
          { art: 940202, bezeichnung: "Old adult", betrag1: "54" },
          { art: 940204, bezeichnung: "Scheduled young adult", betrag1: "45" },
          { art: 940200, bezeichnung: "Scheduled adult", betrag1: "60" },
          { art: 940201, bezeichnung: "Old tagged family", betrag1: "96", antragsRolle: "familie" },
        ]);
      await db()
        .insert(orgTable)
        .values({
          id: 1,
          vereinsname: "Schedule Test",
          glaeubigerId: "TEST",
          vereinsIban: "DE89370400440532013000",
          vereinsIbanLast4: "3000",
          vereinsBic: "COBADEFFXXX",
          beitragsstaffel: old,
          applicationFeeSchedule: schedule,
        })
        .onConflictDoUpdate({
          target: orgTable.id,
          set: {
            beitragsstaffel: old,
            applicationFeeSchedule: schedule,
            kategorieKindMaxAlter: 14,
            kategorieJugendlichMaxAlter: 18,
            kategorieJungerErwachsenerMaxAlter: 25,
            tenantPolicy: { departmentPerPersonRequired: false } as never,
          },
        });
    });
    afterEach(() => vi.useRealTimers());
    afterAll(async () => {
      if (previous) await db().update(orgTable).set(previous).where(eq(orgTable.id, 1));
      else await db().delete(orgTable).where(eq(orgTable.id, 1));
      await db()
        .delete(feeTypesTable)
        .where(inArray(feeTypesTable.art, [940200, 940201, 940202, 940204]));
      await db().delete(users).where(eq(users.id, "schedule-actor"));
    });
    it("public quote and settings switch at Berlin midnight without restart", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-31T22:59:59Z"));
      expect(
        (
          await call(
            appRouter.applications.calculateFee,
            { geburtsdatum: "1990-06-01", antragstyp: "einzel" },
            { context: ctx() },
          )
        ).jahresbeitrag,
      ).toBe("54");
      vi.setSystemTime(new Date("2026-12-31T23:00:00Z"));
      const adult = await call(
        appRouter.applications.calculateFee,
        { geburtsdatum: "1990-06-01", antragstyp: "einzel" },
        { context: ctx() },
      );
      expect(adult.jahresbeitrag).toBe("60.00");
      expect(adult.art).toBe(940200);
      const young = await call(
        appRouter.applications.calculateFee,
        { geburtsdatum: "2000-06-01", antragstyp: "einzel" },
        { context: ctx() },
      );
      expect(young.kategorie).toBe("junger_erwachsener");
      expect(young.jahresbeitrag).toBe("45.00");
      expect(
        (await call(appRouter.applications.publicSettings, undefined, { context: ctx() }))
          .beitragsstaffel?.erwachsener,
      ).toBe("60");
    });
    it("scheduled fallback does not accidentally use an old tagged tariff", async () => {
      const [org] = await db().select().from(orgTable).limit(1);
      const fee = await resolveApplicationFee(db(), {
        kategorie: "familie",
        elternteilMitglied: false,
        ...applicationFeeSettings(org!, new Date("2027-01-01")),
      });
      expect(fee.betrag).toBe("100");
      expect(fee.art).toBeNull();
    });
    it("requires an admin and rejects mismatched tariff assignments", async () => {
      await expect(
        call(appRouter.organization.scheduleApplicationFees, { schedule }, { context: ctx() }),
      ).rejects.toThrow("Anmeldung erforderlich");
      const context = {
        ...ctx(),
        session: {
          user: { id: "schedule-actor", email: "schedule-actor@example.test", role: "admin" },
          session: { id: "schedule-session", userId: "schedule-actor" },
        },
      } as AppContext;
      await expect(
        call(
          appRouter.organization.scheduleApplicationFees,
          { schedule: { ...schedule, feeTypes: { erwachsener: 940201 } } },
          { context },
        ),
      ).rejects.toThrow("zum geplanten Betrag passen");
      expect((await db().select().from(orgTable).limit(1))[0]!.applicationFeeSchedule).toEqual(
        schedule,
      );
    });
    it.each([
      { birth: "1990-06-01", art: 940200, amount: "60.00000000" },
      { birth: "2000-06-01", art: 940204, amount: "45.00000000" },
    ])(
      "schedules late-year admission at the new age boundary: $birth",
      async ({ birth, art, amount }) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
        const member = await db().transaction((tx) =>
          onboardMember(tx, {
            patch: {
              vorname: "Demo",
              nachname: "Late admission",
              geburtsdatum: new Date(birth),
            },
            isKontakt: false,
            status: "aktiv",
            abteilungen: [],
            fallbackEintritt: "2026-12-01",
            contract: {
              art: 940202,
              artName: "Old adult",
              betrag: "54",
              vertragNr: null,
              vertragBegin: new Date(),
              sollstellung: "jährlich",
              applicationFeeRole: "erwachsener",
              abwKontoInh: "Demo Zahler",
            },
            sepa: null,
            actorId: "schedule-actor",
            actorEmail: "schedule-actor@example.test",
            requestId: "schedule-test",
          }),
        );
        try {
          const contracts = await db()
            .select()
            .from(contractsTable)
            .where(eq(contractsTable.memberId, member.id));
          expect(contracts).toHaveLength(2);
          const oldContract = contracts.find((c) => c.art === 940202)!;
          const next = contracts.find((c) => c.art === art)!;
          expect(oldContract.betrag).toBe("54.00000000");
          expect(next.betrag).toBe(amount);
          expect(next.abwKontoInh).toBe("Demo Zahler");
          expect(oldContract.vertragEnde?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
          expect(next.vertragBegin).toEqual(oldContract.vertragEnde);
          expect(next.seriesId).toBe(oldContract.seriesId);
        } finally {
          await db().delete(membersTable).where(eq(membersTable.id, member.id));
        }
      },
    );
    it("rejects a pre-midnight quote submitted after the rollover", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2027-01-01"));
      await expect(
        call(
          appRouter.applications.submit,
          {
            vorname: "Demo",
            nachname: "Schedule",
            geburtsdatum: "1990-06-01",
            strasse: "Teststrasse",
            hausnummer: "1",
            plz: "97508",
            ort: "Testort",
            telefonOptOut: true,
            email: "schedule@example.test",
            abteilungen: [],
            iban: "DE89370400440532013000",
            bic: "COBADEFFXXX",
            datenschutzAccepted: true,
            satzungAccepted: true,
            expectedAnnualFee: "54",
          },
          { context: ctx() },
        ),
      ).rejects.toThrow("Beitrag hat sich geändert");
    });
  },
);
