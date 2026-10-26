import { describe, expect, it } from "vitest";
import { berlinCalendar, birthdayInWeek } from "~/server/mail/birthday-reminders";

describe("birthday calendar", () => {
  it("uses Berlin Monday across the UTC Sunday boundary", () => {
    const c = berlinCalendar(new Date("2026-10-25T23:30:00Z"));
    expect(c.isMonday).toBe(true);
    expect(c.week).toBe("2026-10-26");
    expect(c.time).toBe("00:30");
    expect(c.sunday.toISOString().slice(0, 10)).toBe("2026-11-01");
  });
  it("includes Sunday and a birthday after New Year, but excludes the next Monday", () => {
    const c = berlinCalendar(new Date("2026-12-28T08:00:00Z"));
    expect(
      birthdayInWeek(new Date("2000-01-03"), c.monday, c.sunday)?.toISOString().slice(0, 10),
    ).toBe("2027-01-03");
    expect(birthdayInWeek(new Date("2000-01-04"), c.monday, c.sunday)).toBeNull();
  });
  it("observes leap-day birthdays on March 1 in non-leap years", () => {
    const c = berlinCalendar(new Date("2027-03-01T08:00:00Z"));
    expect(
      birthdayInWeek(new Date("2000-02-29"), c.monday, c.sunday)?.toISOString().slice(0, 10),
    ).toBe("2027-03-01");
  });
});
