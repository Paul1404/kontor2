import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { isPublicProductHost } from "~/lib/product-host";

/** Host-aware product-site check that works during SSR and client navigation. */
export const isPublicProductRequest = createIsomorphicFn()
  .client(() => isPublicProductHost(window.location.host))
  .server(() => {
    const headers = getRequestHeaders();
    const host =
      headers.get("host")?.trim() ?? headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    return (
      isPublicProductHost(host, process.env.PRODUCT_DOMAIN ?? "kontor2.com") ||
      (process.env.NODE_ENV !== "production" && process.env.PUBLIC_SITE_PREVIEW === "true")
    );
  });
