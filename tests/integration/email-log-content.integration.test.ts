import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { emailLogTable } from "~/server/db/schema/email-log";
import { recordEmail } from "~/server/mail/email-log";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const ACTOR_ID = `email-log-content-${Date.now()}`;
const SUBJECT = `Archivierte Nachricht ${ACTOR_ID}`;
let logId = "";

function context(role: "admin" | "vorstand"): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "mail-audit@test.local", role },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "email-log-content-test",
  };
}

describe.skipIf(!onTestDb)("email log message snapshot (integration)", () => {
  beforeAll(async () => {
    await db().insert(users).values({
      id: ACTOR_ID,
      name: "Mail Audit Integration",
      email: "mail-audit@test.local",
      emailVerified: true,
      role: "admin",
    });
    await recordEmail(
      {
        kind: "test_mail",
        status: "sent",
        recipient: "recipient@example.test",
        subject: SUBJECT,
        bodyText: "Hallo aus dem Textteil.",
        bodyHtml: "<p>Hallo aus dem <strong>HTML-Teil</strong>.</p>",
        attachmentNames: ["beleg.pdf"],
        actorEmail: "mail-audit@test.local",
      },
      db(),
    );
    const [row] = await db()
      .select({ id: emailLogTable.id })
      .from(emailLogTable)
      .where(eq(emailLogTable.subject, SUBJECT));
    logId = row!.id;
  });

  afterAll(async () => {
    if (logId) await db().delete(emailLogTable).where(eq(emailLogTable.id, logId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("returns the exact stored text, HTML, and attachment names to an admin", async () => {
    const row = await call(appRouter.emailLog.get, { id: logId }, { context: context("admin") });

    expect(row).toMatchObject({
      bodyText: "Hallo aus dem Textteil.",
      bodyHtml: "<p>Hallo aus dem <strong>HTML-Teil</strong>.</p>",
      attachmentNames: ["beleg.pdf"],
    });
  });

  it("does not expose message bodies through the paginated list", async () => {
    const result = await call(
      appRouter.emailLog.list,
      { q: SUBJECT },
      { context: context("admin") },
    );

    expect(result.rows[0]).toMatchObject({ id: logId, hasContent: true });
    expect(result.rows[0]).not.toHaveProperty("bodyText");
    expect(result.rows[0]).not.toHaveProperty("bodyHtml");
  });

  it("keeps the detail endpoint admin-only", async () => {
    await expect(
      call(appRouter.emailLog.get, { id: logId }, { context: context("vorstand") }),
    ).rejects.toThrow();
  });
});
