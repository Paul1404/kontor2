import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import {
  ApplicationFeeScheduleInput,
  applicationFeeSettings,
} from "~/lib/application-fee-schedule";
import { categoryFromAge } from "~/server/domain/application/antragstyp";

const staffel = {
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
  staffel: { ...staffel, erwachsener: "60", jungerErwachsener: "45" },
  altersgrenzen: { kindMax: 14, jugendlichMax: 18, jungerErwachsenerMax: 27 },
  feeTypes: { erwachsener: 200 },
};
const org = {
  beitragsstaffel: staffel,
  kategorieKindMaxAlter: 14,
  kategorieJugendlichMaxAlter: 18,
  kategorieJungerErwachsenerMaxAlter: 25,
  applicationFeeSchedule: schedule,
};
describe("scheduled application fees", () => {
  it("switches prices and age bands together at midnight in Berlin", () => {
    expect(
      applicationFeeSettings(org, new Date("2026-12-31T22:59:59.999Z")).staffel?.erwachsener,
    ).toBe("54");
    const active = applicationFeeSettings(org, new Date("2026-12-31T23:00:00Z"));
    expect(active.staffel?.erwachsener).toBe("60");
    expect(active.altersgrenzen.jungerErwachsenerMax).toBe(27);
    expect(active.feeTypes?.erwachsener).toBe(200);
    expect(
      categoryFromAge(
        new Date("2000-06-01"),
        active.altersgrenzen,
        false,
        new Date("2026-12-31T23:00:00Z"),
      ),
    ).toBe("junger_erwachsener");
  });
  it("keeps historical applications and unconfigured clubs on their original schedule", () => {
    expect(applicationFeeSettings(org, new Date("2026-10-29")).staffel).toEqual(staffel);
    expect(
      applicationFeeSettings({ ...org, applicationFeeSchedule: null }, new Date("2027-06-01"))
        .staffel,
    ).toEqual(staffel);
  });
  it("rejects negative fees, impossible dates and unordered boundaries", () => {
    expect(() =>
      parse(ApplicationFeeScheduleInput, { ...schedule, effectiveFrom: "2027-02-30" }),
    ).toThrow();
    expect(() =>
      parse(ApplicationFeeScheduleInput, { ...schedule, staffel: { ...staffel, kind: "-1" } }),
    ).toThrow();
    expect(() =>
      parse(ApplicationFeeScheduleInput, {
        ...schedule,
        altersgrenzen: { kindMax: 18, jugendlichMax: 14, jungerErwachsenerMax: 27 },
      }),
    ).toThrow();
  });
});
