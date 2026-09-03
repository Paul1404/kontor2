import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendBrandedMail } = vi.hoisted(() => ({ sendBrandedMail: vi.fn() }));

vi.mock("~/server/auth/send-invite", () => ({ sendBrandedMail }));

import type { DB } from "~/server/db/client";
import { sendPortalInvite } from "~/server/portal/send-portal-invite";

describe("sendPortalInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendBrandedMail.mockResolvedValue({
      ok: true,
      subject: "",
      bodyText: "",
      bodyHtml: "",
    });
  });

  it("dispatches through the request tenant database", async () => {
    const tenantDb = { tenant: "secondary" } as unknown as DB;

    await sendPortalInvite(tenantDb, {
      to: "member@example.test",
      memberName: "Test Mitglied",
      vereinsname: "Tenant Verein",
      portalUrl: "https://tenant.test/portal/token",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    });

    expect(sendBrandedMail).toHaveBeenCalledOnce();
    // The tenant db decides both the SMTP config and the club branding.
    expect(sendBrandedMail.mock.calls[0]?.[0]).toBe(tenantDb);
  });

  it("carries the portal link and its expiry into the mail", async () => {
    await sendPortalInvite({} as DB, {
      to: "member@example.test",
      memberName: "Test Mitglied",
      vereinsname: "Tenant Verein",
      portalUrl: "https://tenant.test/portal/token",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    });

    const options = sendBrandedMail.mock.calls[0]?.[1];
    expect(options.to).toBe("member@example.test");
    expect(options.subject).toBe("Tenant Verein: Zugang zum Mitgliederportal");
    expect(options.document.blocks).toContainEqual({
      kind: "button",
      label: "Portal öffnen",
      url: "https://tenant.test/portal/token",
    });
    expect(JSON.stringify(options.document.blocks)).toContain("01.08.2026");
  });
});
