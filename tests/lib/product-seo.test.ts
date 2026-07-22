import { describe, expect, it } from "vitest";
import {
  PRODUCT_ORIGIN,
  productRobotsTxt,
  productSitemapXml,
  productStructuredData,
} from "~/lib/product-seo";

describe("public product SEO", () => {
  it("allows crawling only on the product host", () => {
    expect(productRobotsTxt(true)).toContain(`Sitemap: ${PRODUCT_ORIGIN}/sitemap.xml`);
    expect(productRobotsTxt(false)).toBe("User-agent: *\nDisallow: /\n");
  });

  it("publishes only canonical public pages in the sitemap", () => {
    const xml = productSitemapXml();
    expect(xml).toContain("https://kontor2.com/</loc>");
    expect(xml).toContain("https://kontor2.com/impressum</loc>");
    expect(xml).toContain("https://kontor2.com/datenschutz</loc>");
    expect(xml).not.toContain("/app");
  });

  it("describes the website and software without invented pricing", () => {
    const json = JSON.stringify(productStructuredData());
    expect(json).toContain('"SoftwareApplication"');
    expect(json).toContain("Sportvereine");
    expect(json).not.toContain('"offers"');
  });
});
