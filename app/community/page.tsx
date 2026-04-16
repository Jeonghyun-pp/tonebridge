/**
 * /community  — public index of all reference tones.
 *
 * Server Component. Lists most-popular Tier A first, then by year,
 * paginated. SEO surface: each card links to /community/[slug].
 */
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { referenceTones } from "@/lib/db/schema";
import { toSlug } from "@/lib/community/slug";
import { ConfidenceBadge } from "@/components/result-card/confidence-badge";

// Cache for 1 hour at the edge — catalog changes are batched, not real-time.
export const revalidate = 3600;

export const metadata = {
  title: "Community Tones — ToneBridge",
  description:
    "Browse the catalog: amp settings, pedal chains, and pickup choices for famous guitar tones, with confidence-ranked sources.",
};

export default async function CommunityIndexPage() {
  const rows = await db
    .select({
      song: referenceTones.song,
      artist: referenceTones.artist,
      section: referenceTones.section,
      toneType: referenceTones.toneType,
      instrument: referenceTones.instrument,
      mode: referenceTones.mode,
      confidence: referenceTones.confidence,
      genre: referenceTones.genre,
    })
    .from(referenceTones)
    .orderBy(
      // Authoritative first (sort by mode lexicographically since tone_mode
      // enum's 'authoritative' < 'inferred' < 'speculative' alphabetically),
      // then by id desc as a stable tiebreaker.
      sql`CASE ${referenceTones.mode}
            WHEN 'authoritative' THEN 0
            WHEN 'inferred'      THEN 1
            ELSE 2 END`,
      desc(referenceTones.id)
    )
    .limit(200);

  const verifiedCount = rows.filter((r) => r.mode === "authoritative").length;

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12">
      <div className="w-full max-w-4xl flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Community tones</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {rows.length.toLocaleString()} songs · {verifiedCount.toLocaleString()} verified by primary sources.
            Pick one to see the rig recipe; sign in to translate it to your gear.
          </p>
        </header>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map((r) => (
            <li key={`${r.song}|${r.artist}|${r.section}|${r.toneType ?? ""}`}>
              <Link
                href={`/community/${toSlug(r)}`}
                className="block rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 hover:border-zinc-400 dark:hover:border-zinc-600"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium truncate">
                    {r.song} <span className="text-zinc-500 font-normal">— {r.artist}</span>
                  </span>
                  <ConfidenceBadge mode={r.mode} confidence={r.confidence ? Number(r.confidence) : null} />
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="uppercase">{r.section}</span>
                  {r.toneType && <span>· {r.toneType}</span>}
                  {r.genre && <span className="ml-auto">{r.genre}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <p className="text-center text-sm text-zinc-500 py-12">
            No tones cataloged yet. Check back soon.
          </p>
        )}
      </div>
    </main>
  );
}
