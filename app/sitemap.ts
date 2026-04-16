/**
 * Auto-generated sitemap from reference_tones + static marketing routes.
 *
 * Caps at 5,000 entries (Google's per-sitemap limit is 50K but our SEO
 * value drops off long before that — Tier A authoritative + most popular
 * Tier B is the sweet spot).
 */
import type { MetadataRoute } from "next";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { referenceTones } from "@/lib/db/schema";
import { toSlug } from "@/lib/community/slug";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let toneRows: Array<{
    song: string;
    artist: string;
    section: typeof referenceTones.$inferSelect.section;
    toneType: typeof referenceTones.$inferSelect.toneType;
    instrument: string;
    mode: typeof referenceTones.$inferSelect.mode;
    updatedAt: Date;
  }> = [];

  try {
    toneRows = await db
      .select({
        song: referenceTones.song,
        artist: referenceTones.artist,
        section: referenceTones.section,
        toneType: referenceTones.toneType,
        instrument: referenceTones.instrument,
        mode: referenceTones.mode,
        updatedAt: referenceTones.updatedAt,
      })
      .from(referenceTones)
      .orderBy(
        sql`CASE ${referenceTones.mode}
              WHEN 'authoritative' THEN 0
              WHEN 'inferred'      THEN 1
              ELSE 2 END`,
        desc(referenceTones.updatedAt)
      )
      .limit(5000);
  } catch {
    // DB unavailable (cold dev / build w/o DB) — emit just the static routes.
    toneRows = [];
  }

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, priority: 1.0, changeFrequency: "weekly" },
    { url: `${SITE_URL}/pricing`, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE_URL}/community`, priority: 0.9, changeFrequency: "daily" },
  ];

  const toneRoutes: MetadataRoute.Sitemap = toneRows.map((r) => ({
    url: `${SITE_URL}/community/${toSlug(r)}`,
    lastModified: r.updatedAt,
    priority: r.mode === "authoritative" ? 0.7 : 0.4,
    changeFrequency: "monthly",
  }));

  return [...staticRoutes, ...toneRoutes];
}
