import { call } from "@orpc/server";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

const YEAR = 2090;
const marker = `HonorsMilestones-${Date.now()}`;
const ids: string[] = [];
const context = (): AppContext => ({
  db: db(),
  tenant: { key: marker, databaseUrl: "" },
  headers: new Headers(),
  session: {
    user: { id: marker, email: "honors@example.test", role: "readonly" },
    session: { id: marker, userId: marker },
  } as unknown as Session,
  requestId: marker,
});
describe.skipIf(!process.env.DATABASE_URL?.includes("svuwv_test"))(
  "honors five-year milestones",
  () => {
    beforeAll(async () => {
      const [max] = await db()
        .select({ adr: sql<number>`coalesce(max(adr_nr),0)::int` })
        .from(membersTable);
      let adr = max!.adr;
      for (const years of [...Array.from({ length: 26 }, (_, i) => 25 + i * 5), 24, 26]) {
        const [member] = await db()
          .insert(membersTable)
          .values({
            adrNr: ++adr,
            memberNo: `${marker}-${years}`,
            vorname: `Jubilaeum${years}`,
            nachname: marker,
            eintritt: new Date(`${YEAR - years}-05-01T00:00:00Z`),
          })
          .returning({ id: membersTable.id });
        ids.push(member!.id);
      }
      for (const kind of ["contact", "exited"]) {
        const [member] = await db()
          .insert(membersTable)
          .values({
            adrNr: ++adr,
            memberNo: kind === "contact" ? null : `${marker}-former`,
            kontaktNo: kind === "contact" ? `${marker}-contact` : null,
            vorname: kind,
            nachname: marker,
            eintritt: new Date(`${YEAR - 35}-05-01T00:00:00Z`),
            austritt: kind === "exited" ? new Date(`${YEAR}-04-30T00:00:00Z`) : null,
          })
          .returning({ id: membersTable.id });
        ids.push(member!.id);
      }
    });
    afterAll(async () => {
      if (ids.length) await db().delete(membersTable).where(inArray(membersTable.id, ids));
    });
    it("defaults to every fifth year from 25, including all previously missing milestones", async () => {
      const result = await call(appRouter.reports.ehrungen, { year: YEAR }, { context: context() });
      expect(result.groups.map((g) => g.jubilee)).toEqual(
        Array.from({ length: 26 }, (_, i) => 150 - i * 5),
      );
      const ours = result.groups.flatMap((g) => g.members.filter((m) => m.nachname === marker));
      expect(ours).toHaveLength(26);
      for (const year of [30, 35, 45, 55, 65, 80, 150])
        expect(ours.some((m) => m.vorname === `Jubilaeum${year}`)).toBe(true);
    });
    it("exports the additional milestones and honors an explicit narrower filter", async () => {
      const csv = await call(
        appRouter.reports.ehrungenExport,
        { year: YEAR },
        { context: context() },
      );
      for (const year of [30, 35, 45, 55, 65]) expect(csv.content).toContain(`Jubilaeum${year}`);
      expect(csv.content).not.toContain("Jubilaeum24");
      expect(csv.content).not.toContain("Jubilaeum26");
      const filtered = await call(
        appRouter.reports.ehrungen,
        { year: YEAR, jubilaeen: [35, 65] },
        { context: context() },
      );
      expect(filtered.groups.map((g) => g.jubilee)).toEqual([65, 35]);
      expect(
        filtered.groups.flatMap((g) => g.members).filter((m) => m.nachname === marker),
      ).toHaveLength(2);
    });
  },
);
