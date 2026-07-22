import { createFileRoute } from "@tanstack/react-router";
import { isPublicProductHost } from "~/lib/product-host";
import { productRobotsTxt } from "~/lib/product-seo";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host =
          request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
          request.headers.get("host");
        const body = productRobotsTxt(
          isPublicProductHost(host, process.env.PRODUCT_DOMAIN ?? "kontor2.com"),
        );
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
