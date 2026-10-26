import { and, eq, inArray } from "drizzle-orm";
import { sendBrandedMail } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { memberIsCurrent } from "~/server/db/member-filters";
import { users } from "~/server/db/schema/auth";
import {
  birthdayDeliveriesTable,
  birthdaySettingsTable,
} from "~/server/db/schema/birthday-reminders";
import { membersTable } from "~/server/db/schema/members";
import { recordEmail } from "~/server/mail/email-log";

export function berlinCalendar(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    date,
    monday,
    sunday,
    week: monday.toISOString().slice(0, 10),
    time: `${parts.hour}:${parts.minute}`,
    isMonday: date.getUTCDay() === 1,
  };
}
export function birthdayInWeek(birth: Date, start: Date, end: Date): Date | null {
  for (const year of new Set([start.getUTCFullYear(), end.getUTCFullYear()])) {
    const day = new Date(Date.UTC(year, birth.getUTCMonth(), birth.getUTCDate()));
    if (day >= start && day <= end) return day;
  }
  return null;
}
export async function runBirthdayReminders(db: DB, now = new Date(), testRecipient?: string) {
  const calendar = berlinCalendar(now);
  const [settings] = await db
    .select()
    .from(birthdaySettingsTable)
    .where(eq(birthdaySettingsTable.id, 1));
  if (!testRecipient && (!settings?.enabled || !calendar.isMonday || calendar.time < settings.time))
    return { sent: 0, skipped: 0 };
  const selected = settings?.userIds.length
    ? await db
        .select({ email: users.email })
        .from(users)
        .where(and(inArray(users.id, settings.userIds), eq(users.banned, false)))
    : [];
  const recipients = testRecipient
    ? [testRecipient]
    : [...(settings?.emails ?? []), ...selected.map((u) => u.email)];
  const unique = [
    ...new Set(
      recipients
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    ),
  ];
  const people = await db
    .select({
      name: membersTable.vorname,
      lastName: membersTable.nachname,
      birth: membersTable.geburtsdatum,
      austritt: membersTable.austritt,
    })
    .from(membersTable)
    .where(memberIsCurrent());
  const birthdays = people
    .flatMap((p) => {
      if (!p.birth) return [];
      const day = birthdayInWeek(p.birth, calendar.monday, calendar.sunday);
      if (!day || (p.austritt && p.austritt <= day)) return [];
      return [
        {
          name: [p.name, p.lastName].filter(Boolean).join(" "),
          day,
          birth: p.birth,
          age: day.getUTCFullYear() - p.birth.getUTCFullYear(),
        },
      ];
    })
    .sort((a, b) => a.day.getTime() - b.day.getTime() || a.name.localeCompare(b.name));
  const fmt = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(d);
  const subject = `${testRecipient ? "Test: " : ""}Geburtstage ${fmt(calendar.monday)} bis ${fmt(calendar.sunday)}`;
  let sent = 0,
    skipped = 0;
  for (const recipient of unique.length ? unique : [""]) {
    if (!testRecipient) {
      const claimed = await db
        .insert(birthdayDeliveriesTable)
        .values({ week: calendar.week, recipient, status: "processing" })
        .onConflictDoNothing()
        .returning({ week: birthdayDeliveriesTable.week });
      if (!claimed.length) continue;
    }
    let status: "sent" | "skipped" | "failed" = "failed";
    try {
      if (!recipient) {
        status = "skipped";
        skipped++;
        await recordEmail(
          {
            kind: "birthday_reminder",
            status,
            subject,
            detail: "no_recipient",
            entityType: "birthday_week",
            entityId: calendar.week,
          },
          db,
        );
        continue;
      }
      const result = await sendBrandedMail(db, {
        to: recipient,
        subject,
        document: {
          preheader: subject,
          subline: "Geburtstagserinnerung",
          greeting: null,
          closing: null,
          blocks: [
            {
              kind: "paragraph",
              text: birthdays.length
                ? birthdays
                    .map(
                      (p) => `${fmt(p.day)}: ${p.name}, geboren am ${fmt(p.birth)}, wird ${p.age}`,
                    )
                    .join("\n")
                : "In dieser Woche stehen keine Geburtstage an.",
            },
          ],
        },
      });
      status = result.ok ? "sent" : result.reason === "smtp_not_configured" ? "skipped" : "failed";
      if (result.ok) sent++;
      else skipped++;
      await recordEmail(
        {
          kind: "birthday_reminder",
          status,
          recipient,
          subject,
          bodyText: result.bodyText,
          bodyHtml: result.bodyHtml,
          messageId: result.messageId,
          detail: result.ok ? null : result.reason,
          entityType: "birthday_week",
          entityId: calendar.week,
        },
        db,
      );
    } catch (error) {
      await recordEmail(
        {
          kind: "birthday_reminder",
          status: "failed",
          recipient,
          subject,
          detail: error instanceof Error ? error.message : "Versand fehlgeschlagen",
          entityType: "birthday_week",
          entityId: calendar.week,
        },
        db,
      );
    } finally {
      if (!testRecipient)
        await db
          .update(birthdayDeliveriesTable)
          .set({ status })
          .where(
            and(
              eq(birthdayDeliveriesTable.week, calendar.week),
              eq(birthdayDeliveriesTable.recipient, recipient),
            ),
          );
    }
  }
  return { sent, skipped };
}
