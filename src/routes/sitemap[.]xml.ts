import { createFileRoute } from "@tanstack/react-router";
import { isPublicProductHost } from "~/lib/product-host";
import { productSitemapXml } from "~/lib/product-seo";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host =
          request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
          request.headers.get("host");
        if (!isPublicProductHost(host, process.env.PRODUCT_DOMAIN ?? "kontor2.com")) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(productSitemapXml(), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
