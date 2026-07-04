import { describe, expect, it } from "vitest";
import {
  isOverridableStatus,
  OVERRIDABLE_STATUSES,
  planSollstellungStatus,
} from "~/server/domain/sollstellung-status";

describe("planSollstellungStatus", () => {
  const row = { amount: "54.00000000" };

  it("open: full amount open, nothing paid, dunning reset", () => {
    expect(planSollstellungStatus(row, "open")).toEqual({
      status: "open",
      paidAmount: "0",
      openAmount: "54.00000000",
      mahnstufe: 0,
    });
  });

  it("eingezogen: paid = amount, nothing open, not dunnable", () => {
    expect(planSollstellungStatus(row, "eingezogen")).toEqual({
      status: "eingezogen",
      paidAmount: "54.00000000",
      openAmount: "0",
      mahnstufe: 0,
    });
  });

  it("paid: paid = amount, nothing open", () => {
    expect(planSollstellungStatus(row, "paid")).toEqual({
      status: "paid",
      paidAmount: "54.00000000",
      openAmount: "0",
      mahnstufe: 0,
    });
  });

  it("cancelled: neither open nor paid", () => {
    expect(planSollstellungStatus(row, "cancelled")).toEqual({
      status: "cancelled",
      paidAmount: "0",
      openAmount: "0",
      mahnstufe: 0,
    });
  });

  it("every overridable status is planned and never leaves an open amount when settled", () => {
    for (const target of OVERRIDABLE_STATUSES) {
      const plan = planSollstellungStatus(row, target);
      expect(plan.status).toBe(target);
      if (target === "open") expect(plan.openAmount).toBe(row.amount);
      else expect(plan.openAmount).toBe("0");
    }
  });
});

describe("isOverridableStatus", () => {
  it("accepts the four manual targets", () => {
    for (const s of OVERRIDABLE_STATUSES) expect(isOverridableStatus(s)).toBe(true);
  });

  it("rejects returned and unknown values", () => {
    expect(isOverridableStatus("returned")).toBe(false);
    expect(isOverridableStatus("garbage")).toBe(false);
  });
});
