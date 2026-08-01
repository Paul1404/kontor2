import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "~/server/db/client";

const state = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  list: vi.fn(),
  mailboxOpen: vi.fn(),
  search: vi.fn(),
  fetchAll: vi.fn(),
  fetchOne: vi.fn(),
  connect: vi.fn(),
  logout: vi.fn(),
  close: vi.fn(),
  loadSmtpConfig: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    usable = true;
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
    connect = state.connect;
    list = state.list;
    mailboxOpen = state.mailboxOpen;
    search = state.search;
    fetchAll = state.fetchAll;
    fetchOne = state.fetchOne;
    logout = state.logout;
    close = state.close;
  },
}));

vi.mock("~/server/auth/send-invite", () => ({
  loadSmtpConfig: state.loadSmtpConfig,
}));

import { findSentMessage, testSentMailbox } from "~/server/mail/read-sent-mail";

const SENT_AT = new Date("2026-08-01T17:15:00.000Z");

describe("read-only sent mail lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.options = null;
    state.connect.mockResolvedValue(undefined);
    state.mailboxOpen.mockResolvedValue(undefined);
    state.logout.mockResolvedValue(undefined);
    state.loadSmtpConfig.mockResolvedValue({
      host: "mail.example.test",
      username: "verein@example.test",
      password: "secret",
      allowInvalidCerts: false,
    });
    state.list.mockResolvedValue([
      { path: "INBOX", specialUse: undefined },
      { path: "Sent", specialUse: "\\Sent" },
    ]);
    state.search.mockResolvedValue([42]);
    state.fetchAll.mockResolvedValue([
      {
        uid: 42,
        size: 1024,
        internalDate: SENT_AT,
        envelope: {
          date: SENT_AT,
          subject: "Bankverbindung geändert",
          to: [{ address: "member@example.test" }],
        },
      },
    ]);
    state.fetchOne.mockResolvedValue({
      uid: 42,
      source: Buffer.from(
        [
          "Message-ID: <test@example.test>",
          "Subject: Bankverbindung geändert",
          "To: member@example.test",
          "Content-Type: multipart/alternative; boundary=mail",
          "",
          "--mail",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Die Bankverbindung wurde geändert.",
          "--mail",
          "Content-Type: text/html; charset=utf-8",
          "",
          "<p>Die Bankverbindung wurde <strong>geändert</strong>.</p>",
          "--mail--",
        ].join("\r\n"),
      ),
    });
  });

  it("uses the SMTP credentials on IMAPS 993 and opens Sent read-only", async () => {
    const result = await findSentMessage({} as DB, {
      recipient: "member@example.test",
      subject: "Bankverbindung geändert",
      sentAt: SENT_AT,
    });

    expect(state.options).toMatchObject({
      host: "mail.example.test",
      port: 993,
      secure: true,
      auth: { user: "verein@example.test", pass: "secret" },
      disableAutoIdle: true,
    });
    expect(state.mailboxOpen).toHaveBeenCalledWith("Sent", { readOnly: true });
    expect(result).toMatchObject({
      bodyText: "Die Bankverbindung wurde geändert.",
      bodyHtml: "<p>Die Bankverbindung wurde <strong>geändert</strong>.</p>",
      mailbox: "Sent",
      messageId: "<test@example.test>",
    });
    expect(state.logout).toHaveBeenCalledOnce();
  });

  it("tests the same read-only sent folder without fetching messages", async () => {
    await expect(testSentMailbox({} as DB)).resolves.toEqual({ mailbox: "Sent" });
    expect(state.mailboxOpen).toHaveBeenCalledWith("Sent", { readOnly: true });
    expect(state.search).not.toHaveBeenCalled();
  });

  it("does not connect when stored credentials are incomplete", async () => {
    state.loadSmtpConfig.mockResolvedValue({
      host: "mail.example.test",
      username: null,
      password: null,
      allowInvalidCerts: false,
    });

    await expect(
      findSentMessage({} as DB, {
        recipient: "member@example.test",
        subject: "Bankverbindung geändert",
        sentAt: SENT_AT,
      }),
    ).resolves.toBeNull();
    expect(state.connect).not.toHaveBeenCalled();
  });
});
