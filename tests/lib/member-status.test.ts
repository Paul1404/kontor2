import { describe, expect, it } from "vitest";
import { memberStatusView } from "~/lib/member-status";

const asOf = new Date("2026-06-09T12:00:00Z");

describe("memberStatusView", () => {
  it("shows a future Austritt as a pending notice, not as exited", () => {
    const view = memberStatusView(
      { status: "aktiv", austritt: "2026-12-31", verstorbenAm: null },
      asOf,
    );
    expect(view.pendingExit).toBe(true);
    expect(view.variant).toBe("warning");
    expect(view.label).toMatch(/^Kündigt zum /);
  });

  it("shows a past Austritt as exited", () => {
    const view = memberStatusView(
      { status: "ausgetreten", austritt: "2026-01-01", verstorbenAm: null },
      asOf,
    );
    expect(view.pendingExit).toBe(false);
    expect(view.label).toBe("Ausgetreten");
  });

  it("ranks soft-delete and death above an exit", () => {
    expect(
      memberStatusView({ status: "aktiv", deletedAt: "2026-05-01", austritt: "2026-12-31" }, asOf)
        .label,
    ).toBe("Gelöscht");
    expect(
      memberStatusView(
        { status: "aktiv", verstorbenAm: "2026-05-01", austritt: "2026-12-31" },
        asOf,
      ).label,
    ).toBe("Verstorben");
  });

  it("derives aktiv/passiv from the presence of an active Abteilung", () => {
    expect(memberStatusView({ hatAktiveAbteilung: false }, asOf).label).toBe("Passiv");
    expect(memberStatusView({ hatAktiveAbteilung: true }, asOf).label).toBe("Aktiv");
    // No Abteilung signal at all: a live member renders as aktiv.
    expect(memberStatusView({}, asOf).label).toBe("Aktiv");
  });
});
