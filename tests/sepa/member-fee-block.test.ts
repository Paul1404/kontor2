import { describe, expect, it } from "vitest";
import { memberFeeBlockReason } from "~/server/sepa/build-fee-run";

describe("memberFeeBlockReason", () => {
  it("returns null for a normal, billable member", () => {
    expect(
      memberFeeBlockReason({ beitragsbefreit: false, ruhend: false, directDebitBlocked: false }),
    ).toBeNull();
    expect(memberFeeBlockReason({})).toBeNull();
  });

  it("excludes a fee-exempt member", () => {
    expect(memberFeeBlockReason({ beitragsbefreit: true })).toBe("Beitragsbefreit");
  });

  it("excludes a paused (ruhend) member", () => {
    expect(memberFeeBlockReason({ ruhend: true })).toBe("Ruhend");
  });

  it("excludes a member with a direct-debit hold", () => {
    expect(memberFeeBlockReason({ directDebitBlocked: true })).toBe("Einzug ausgesetzt");
  });

  it("ranks exemption over a pause over a debit hold", () => {
    expect(
      memberFeeBlockReason({ beitragsbefreit: true, ruhend: true, directDebitBlocked: true }),
    ).toBe("Beitragsbefreit");
    expect(memberFeeBlockReason({ ruhend: true, directDebitBlocked: true })).toBe("Ruhend");
  });
});
