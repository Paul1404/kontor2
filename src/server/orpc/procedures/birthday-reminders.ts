import { eq } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { users } from "~/server/db/schema/auth";
import { birthdaySettingsTable } from "~/server/db/schema/birthday-reminders";
import { runBirthdayReminders } from "~/server/mail/birthday-reminders";
import { adminProc } from "~/server/orpc/base";
export const birthdayReminderRouter = {
  get: adminProc.input(v.void()).handler(async ({ context }) => {
    const [settings] = await context.db
      .select()
      .from(birthdaySettingsTable)
      .where(eq(birthdaySettingsTable.id, 1));
    const recipients = await context.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.banned, false));
    return {
      settings: settings ?? { enabled: false, time: "08:00", emails: [], userIds: [] },
      users: recipients,
    };
  }),
  save: adminProc
    .input(
      v.object({
        enabled: v.boolean(),
        time: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/)),
        userIds: v.array(v.string()),
        emails: v.array(v.pipe(v.string(), v.trim(), v.email())),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(birthdaySettingsTable)
          .where(eq(birthdaySettingsTable.id, 1));
        const settings = {
          ...input,
          emails: [...new Set(input.emails.map((e) => e.toLowerCase()))],
          userIds: [...new Set(input.userIds)],
        };
        await tx
          .insert(birthdaySettingsTable)
          .values({ id: 1, ...settings })
          .onConflictDoUpdate({
            target: birthdaySettingsTable.id,
            set: { ...settings, updatedAt: new Date() },
          });
        await appendAudit(tx, {
          entityType: "organization",
          entityId: "1",
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            birthdayReminder: {
              before: JSON.stringify(before ?? null),
              after: JSON.stringify(settings),
            },
          },
        });
      });
      return { ok: true };
    }),
  test: adminProc
    .input(v.void())
    .handler(({ context }) =>
      runBirthdayReminders(context.db, new Date(), context.session!.user.email),
    ),
};
