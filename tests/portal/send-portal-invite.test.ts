import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadSmtpConfig, createTransport, sendMail } = vi.hoisted(() => ({
  loadSmtpConfig: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("~/server/auth/send-invite", () => ({ loadSmtpConfig }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import type { DB } from "~/server/db/client";
import { sendPortalInvite } from "~/server/portal/send-portal-invite";

describe("sendPortalInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue(undefined);
    loadSmtpConfig.mockResolvedValue({
      host: "smtp.tenant.test",
      port: 587,
      secure: false,
      requireTls: true,
      allowInvalidCerts: false,
      username: null,
      password: null,
      fromAddress: "verein@tenant.test",
      fromName: "Tenant Verein",
    });
  });

  it("loads SMTP settings from the request tenant database", async () => {
    const tenantDb = { tenant: "secondary" } as unknown as DB;

    await sendPortalInvite(tenantDb, {
      to: "member@example.test",
      memberName: "Test Mitglied",
      vereinsname: "Tenant Verein",
      portalUrl: "https://tenant.test/portal/token",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    });

    expect(loadSmtpConfig).toHaveBeenCalledWith(tenantDb);
    expect(sendMail).toHaveBeenCalledOnce();
  });
});
