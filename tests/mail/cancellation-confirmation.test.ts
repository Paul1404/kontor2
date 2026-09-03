import { describe, expect, it } from "vitest";
import type { MailOrganization } from "~/server/mail/branding";
import { renderMail } from "~/server/mail/layout";
import {
  buildCancellationConfirmation,
  type CancellationConfirmationParams,
} from "~/server/mail/send-cancellation-confirmation";

const organization: MailOrganization = {
  displayName: "SV Beispiel",
  legalName: "Sportverein Beispiel 1945 e. V.",
  addressLines: ["Vereinsstraße 1", "97440 Beispielstadt"],
  contactEmail: "mitgliedschaft@sv-beispiel.test",
  contactPhone: "+49 9726 1234",
  brandColor: "#b51f2e",
  logoDataUri: null,
};

/** SV Untereuerheim, § 3 Abs. 2: Jahresende, 6 Wochen. */
function params(overrides: Partial<CancellationConfirmationParams> = {}) {
  return {
    to: "leonie@example.test",
    memberName: "Leonie Gock",
    clubDisplayName: "SV Beispiel",
    noticeReceivedOn: "2026-07-15",
    effectiveDate: "2026-12-31",
    dateMode: "year_end" as const,
    noticeDays: 42,
    statuteReference: "§ 3 Abs. 2",
    outstandingClaimsStatuteReference: "§ 3 Abs. 5",
    hasLetter: false,
    ...overrides,
  };
}

function textOf(p: CancellationConfirmationParams) {
  return renderMail({ ...buildCancellationConfirmation(p).document, organization }).text;
}

describe("cancellation confirmation mail", () => {
  it("names the Austrittstermin in the subject and the body", () => {
    const content = buildCancellationConfirmation(params());
    expect(content.subject).toBe("SV Beispiel: Austritt zum 31.12.2026");
    expect(content.document.greeting).toBe("Guten Tag Leonie Gock,");
    const text = textOf(params());
    expect(text).toContain("Ihre Mitgliedschaft endet am: 31.12.2026");
    expect(text).toContain("Eingang Ihrer Kündigung vom 15.07.2026");
  });

  it("explains the rule that produced the date", () => {
    const text = textOf(params());
    expect(text).toContain(
      "Nach § 3 Abs. 2 der Satzung gilt: Ein Austritt ist nur zum Jahresende möglich, die Kündigungsfrist beträgt 42 Tage.",
    );
  });

  it("keeps outstanding claims explicit", () => {
    expect(textOf(params())).toContain("(§ 3 Abs. 5 der Satzung)");
    // Without a configured reference the statement stands on its own.
    expect(textOf(params({ outstandingClaimsStatuteReference: null }))).toContain(
      "Bereits entstandene Beitragsforderungen bleiben auch danach offen.",
    );
  });

  it("omits the rule sentence when no rule is configured", () => {
    const text = textOf(params({ dateMode: "anytime", noticeDays: 0, statuteReference: null }));
    expect(text).not.toContain("der Satzung gilt");
    expect(text).toContain("Ihre Mitgliedschaft endet am: 31.12.2026");
  });

  it("falls back to a rule sentence without a statute reference", () => {
    const text = textOf(params({ statuteReference: null }));
    expect(text).toContain("Es gilt: Ein Austritt ist nur zum Jahresende möglich");
  });

  it("mentions the attachment only when one travels along", () => {
    expect(textOf(params({ hasLetter: true }))).toContain(
      "Die schriftliche Austrittsbestätigung finden Sie im Anhang.",
    );
    expect(textOf(params())).not.toContain("im Anhang");
  });

  it("works for an Austritt recorded without a written notice", () => {
    const text = textOf(params({ noticeReceivedOn: null }));
    expect(text).toContain("wir bestätigen Ihre Kündigung");
    expect(text).not.toContain("Eingang Ihrer Kündigung vom");
  });

  it("invites a correction, because the derived date is the contentious part", () => {
    expect(textOf(params())).toContain(
      "Sollte der genannte Termin nicht Ihrer Kündigung entsprechen",
    );
  });
});
