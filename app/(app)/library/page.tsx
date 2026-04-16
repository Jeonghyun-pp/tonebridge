/**
 * /library — list of the user's saved tones.
 *
 * Server Component. Most-recent first; basic info per card linking to /result/[id].
 */
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { savedTones } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { ConfidenceBadge, type Mode } from "@/components/result-card/confidence-badge";
import { Music } from "lucide-react";
import type { ResearchTone, AdaptTone } from "@/lib/llm/api-schemas";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const session = await getSession();
  if (!session) return null;     // middleware should have redirected; defensive

  const rows = await db
    .select()
    .from(savedTones)
    .where(eq(savedTones.userId, session.authId))
    .orderBy(desc(savedTones.createdAt))
    .limit(50);

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 gap-4 text-center">
        <Music className="h-10 w-10 text-zinc-400" aria-hidden />
        <h1 className="text-xl font-semibold">No saved tones yet</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm">
          Search any song and we&apos;ll save the tone here so you can come back to it.
        </p>
        <Link
          href="/search"
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Find your first tone
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 justify-center px-6 py-10">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Your tones</h1>
          <span className="text-xs text-zinc-500">{rows.length} saved</span>
        </header>

        <ul className="flex flex-col gap-2">
          {rows.map((tone) => {
            const research = tone.researchResponse as ResearchTone | null;
            const adapted = tone.adaptedSettings as AdaptTone;
            return (
              <li key={tone.id}>
                <Link
                  href={`/result/${tone.id}`}
                  className="block rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-3 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <h2 className="font-semibold truncate">
                      {tone.songQuery}{" "}
                      <span className="text-zinc-500 font-normal">— {tone.artistQuery}</span>
                    </h2>
                    <ConfidenceBadge
                      mode={(research?.mode ?? "speculative") as Mode}
                      confidence={adapted.confidence}
                    />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    {research?.section && <span className="uppercase">{research.section}</span>}
                    {research?.tone_type && <span>· {research.tone_type}</span>}
                    {tone.feedback === 1 && <span className="text-green-700 dark:text-green-400">· 👍</span>}
                    {tone.feedback === -1 && <span className="text-red-700 dark:text-red-400">· 👎</span>}
                    <span className="ml-auto">
                      {new Date(tone.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
