import { describe, expect, it, vi } from "vitest";
import { triggerDocumentDownload } from "~/lib/download";

/**
 * The two-string form was called with its arguments swapped in two places, so
 * `atob` ran on a filename with umlauts and failed with "The string contains
 * invalid characters", a message that points nowhere near the mistake. The
 * object form cannot be swapped; these tests pin that it stays that way.
 */
describe("triggerDocumentDownload", () => {
  function stubDom() {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    return anchor;
  }

  it("uses the filename as the filename and the base64 as the content", () => {
    const anchor = stubDom();
    // "Brief" in base64, so a swap would try to decode the filename instead.
    triggerDocumentDownload({ filename: "Kündigung Gock.pdf", base64: "QnJpZWY=" });
    expect(anchor.download).toBe("Kündigung Gock.pdf");
    expect(anchor.click).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("accepts a filename with characters that are not valid base64", () => {
    stubDom();
    expect(() =>
      triggerDocumentDownload({ filename: "Grüße & Anlagen (2026).pdf", base64: "QQ==" }),
    ).not.toThrow();
    vi.unstubAllGlobals();
  });
});
