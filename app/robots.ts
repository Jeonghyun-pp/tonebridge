import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/community"],
        // Keep auth + app behind crawlers; nothing useful to index there
        // and we don't want signin pages competing for ranking.
        disallow: ["/auth/", "/api/", "/onboarding", "/search", "/result/", "/library"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
