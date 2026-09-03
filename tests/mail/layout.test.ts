import { describe, expect, it } from "vitest";
import type { MailOrganization } from "~/server/mail/branding";
import { inlineLogoForPreview, paragraphsFromText, renderMail } from "~/server/mail/layout";

const organization: MailOrganization = {
  displayName: "SV Beispiel",
  legalName: "Sportverein Beispiel 1945 e. V.",
  addressLines: ["Vereinsstraße 1", "97440 Beispielstadt"],
  contactEmail: "mitgliedschaft@sv-beispiel.test",
  contactPhone: "+49 9726 1234",
  brandColor: "#b51f2e",
  logoDataUri:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
};

function render(overrides: Partial<Parameters<typeof renderMail>[0]> = {}) {
  return renderMail({
    organization,
    preheader: "Vorschautext",
    subline: "Mitgliederportal",
    greeting: "Guten Tag Berta Beispiel,",
    blocks: [{ kind: "paragraph", text: "erste Zeile." }],
    ...overrides,
  });
}

describe("mail layout", () => {
  it("carries the club identity into header, footer and text part", () => {
    const mail = render();
    expect(mail.html).toContain("SV Beispiel");
    expect(mail.html).toContain("Mitgliederportal");
    expect(mail.html).toContain("#b51f2e");
    expect(mail.html).toContain("Sportverein Beispiel 1945 e. V.");
    expect(mail.html).toContain("E-Mail: mitgliedschaft@sv-beispiel.test");
    expect(mail.text).toContain("SV Beispiel\nMitgliederportal");
    expect(mail.text).toContain("Telefon: +49 9726 1234");
  });

  it("links Kontor² in both parts", () => {
    const mail = render();
    expect(mail.html).toContain('href="https://kontor2.com"');
    expect(mail.html).toContain("Technisch versendet über <a");
    expect(mail.text).toContain("Technisch versendet über Kontor². https://kontor2.com");
  });

  it("ships the logo as an inline attachment, not a data URI", () => {
    const mail = render();
    expect(mail.html).toContain('src="cid:vereinslogo@kontor2"');
    expect(mail.html).not.toContain("data:image/png");
    expect(mail.attachments).toEqual([
      expect.objectContaining({
        filename: "vereinslogo.png",
        contentType: "image/png",
        cid: "vereinslogo@kontor2",
        contentDisposition: "inline",
      }),
    ]);
  });

  it("renders without a logo when the club has none", () => {
    const mail = render({ organization: { ...organization, logoDataUri: null } });
    expect(mail.attachments).toEqual([]);
    expect(mail.html).not.toContain("cid:vereinslogo@kontor2");
    expect(mail.html).toContain("SV Beispiel");
  });

  it("keeps every block in both the HTML and the text alternative", () => {
    const mail = render({
      blocks: [
        { kind: "paragraph", text: "Ein Absatz." },
        { kind: "callout", label: "Antragsnummer", value: "A-2026-0042" },
        { kind: "bullets", items: ["Erster Punkt", "Zweiter Punkt"] },
        { kind: "note", text: "Kleingedrucktes." },
      ],
    });
    for (const needle of [
      "Ein Absatz.",
      "Antragsnummer",
      "A-2026-0042",
      "Erster Punkt",
      "Kleingedrucktes.",
    ]) {
      expect(mail.html).toContain(needle);
      expect(mail.text).toContain(needle);
    }
    expect(mail.text).toContain("- Zweiter Punkt");
  });

  it("gives a button a real link plus a copyable fallback URL", () => {
    const mail = render({
      blocks: [{ kind: "button", label: "Portal öffnen", url: "https://verein.test/portal/abc" }],
    });
    expect(mail.html).toContain('href="https://verein.test/portal/abc"');
    expect(mail.html).toContain("Falls der Button nicht funktioniert");
    // A text-only client must still be able to reach the destination.
    expect(mail.text).toContain("Portal öffnen:\nhttps://verein.test/portal/abc");
  });

  it("refuses to emit a non-http link as an href", () => {
    const mail = render({
      blocks: [{ kind: "button", label: "Klicken", url: "javascript:alert(1)" }],
    });
    expect(mail.html).not.toContain('href="javascript:');
    expect(mail.html).toContain("Klicken: javascript:alert(1)");
  });

  it("escapes club and member content in the HTML", () => {
    const mail = render({
      organization: {
        ...organization,
        displayName: "SV & Partner",
        legalName: "SV <Partner> e. V.",
        addressLines: ["A&B <Straße> 1"],
      },
      greeting: "Guten Tag Berta <Beispiel>,",
      blocks: [{ kind: "paragraph", text: '<script>alert("x")</script>' }],
    });
    expect(mail.html).toContain("SV &amp; Partner");
    expect(mail.html).toContain("SV &lt;Partner&gt; e. V.");
    expect(mail.html).toContain("A&amp;B &lt;Straße&gt; 1");
    expect(mail.html).toContain("Berta &lt;Beispiel&gt;");
    expect(mail.html).not.toContain("<script>");
  });

  it("drops greeting and sign-off for an internal notice", () => {
    const mail = render({ greeting: null, closing: null });
    expect(mail.text).not.toContain("Freundliche Grüße");
    expect(mail.html).not.toContain("Freundliche Grüße");
    expect(mail.text).toContain("erste Zeile.");
  });

  it("splits free-form Rundschreiben text on blank lines", () => {
    expect(paragraphsFromText("Erster Absatz.\n\nZweiter Absatz.\r\n\r\nDritter.")).toEqual([
      { kind: "paragraph", text: "Erster Absatz." },
      { kind: "paragraph", text: "Zweiter Absatz." },
      { kind: "paragraph", text: "Dritter." },
    ]);
    expect(paragraphsFromText("   ")).toEqual([]);
  });

  it("only claims a mail was generated automatically when it was", () => {
    const machine = render();
    expect(machine.text).toContain("Diese Nachricht wurde automatisch erstellt.");
    expect(machine.html).toContain("Diese Nachricht wurde automatisch erstellt.");

    // A Rundschreiben is typed by a person.
    const written = render({ automated: false });
    expect(written.text).not.toContain("automatisch erstellt");
    expect(written.html).not.toContain("automatisch erstellt");
    // The Kontor² credit stays either way.
    expect(written.text).toContain("Technisch versendet über Kontor².");
    expect(written.html).toContain('href="https://kontor2.com"');
  });

  it("swaps the cid logo for a data URI so a browser preview can show it", () => {
    const mail = render();
    expect(mail.html).toContain("cid:vereinslogo@kontor2");
    const preview = inlineLogoForPreview(mail.html, organization);
    expect(preview).not.toContain("cid:vereinslogo@kontor2");
    expect(preview).toContain(organization.logoDataUri as string);
    // The mail itself must keep the cid; only the preview copy is rewritten.
    expect(mail.html).toContain("cid:vereinslogo@kontor2");
  });

  it("leaves preview HTML untouched when the club has no logo", () => {
    const noLogo = { ...organization, logoDataUri: null };
    const mail = renderMail({
      organization: noLogo,
      preheader: "x",
      subline: "y",
      blocks: [{ kind: "paragraph", text: "z" }],
    });
    expect(inlineLogoForPreview(mail.html, noLogo)).toBe(mail.html);
  });

  it("never leaves a run of blank lines in the text part", () => {
    const mail = render({ greeting: null, closing: null, blocks: [] });
    expect(mail.text).not.toMatch(/\n{3,}/);
  });
});

/**
 * The renderer picks its decoder from the MIME label and drops an image whose
 * bytes do not match, without an error. A mislabelled upload would therefore
 * vanish from every letter and mail with no feedback to the admin.
 */
describe("validLogoDataUri", () => {
  const PNG_BYTES =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

  it("accepts a PNG that really is a PNG", async () => {
    const { validLogoDataUri } = await import("~/server/mail/branding");
    const uri = `data:image/png;base64,${PNG_BYTES}`;
    expect(validLogoDataUri(uri)).toBe(uri);
  });

  it("rejects PNG bytes declared as JPEG", async () => {
    const { validLogoDataUri } = await import("~/server/mail/branding");
    expect(validLogoDataUri(`data:image/jpeg;base64,${PNG_BYTES}`)).toBeNull();
  });

  it("rejects bytes that are no image at all", async () => {
    const { validLogoDataUri } = await import("~/server/mail/branding");
    const junk = Buffer.from("kein bild").toString("base64");
    expect(validLogoDataUri(`data:image/png;base64,${junk}`)).toBeNull();
  });

  it("rejects anything that is not a data URI", async () => {
    const { validLogoDataUri } = await import("~/server/mail/branding");
    expect(validLogoDataUri("https://example.test/logo.png")).toBeNull();
    expect(validLogoDataUri(null)).toBeNull();
  });
});
