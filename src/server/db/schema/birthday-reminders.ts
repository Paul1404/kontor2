import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
export const birthdaySettingsTable = pgTable("birthday_reminder_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  time: text("time").notNull().default("08:00"),
  userIds: text("user_ids").array().notNull().default([]),
  emails: text("emails").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const birthdayDeliveriesTable = pgTable(
  "birthday_reminder_deliveries",
  {
    week: text("week").notNull(),
    recipient: text("recipient").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.week, t.recipient] })],
);
