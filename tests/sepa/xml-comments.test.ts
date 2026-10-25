import { describe, expect, it } from "vitest";
import { stripXmlComments } from "~/server/lib/xml-comments";

describe("XML comments", () => {
  it("preserves text adjacency and encoded comment text", () => {
    expect(stripXmlComments("<Id>DE<!-- note -->123</Id>")).toBe("<Id>DE123</Id>");
    expect(stripXmlComments("&lt;!-- text --&gt;")).toBe("&lt;!-- text --&gt;");
  });

  it("does not leave comment markers reconstructed by removal", () => {
    expect(() => stripXmlComments("<!<!---->--hidden-->")).toThrow("XML-Kommentar");
  });

  it.each(["<!-- unclosed", "<!-- outer <!-- inner --> -->", "<!-- bad -- text -->"])(
    "rejects invalid comment syntax: %s",
    (xml) => expect(() => stripXmlComments(xml)).toThrow("XML-Kommentar"),
  );
});
