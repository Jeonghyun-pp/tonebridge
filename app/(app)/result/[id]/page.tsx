/**
 * GET /result/[id]  — Server Component.
 *
 * Renders the saved Stage 2 result. Uses RLS to ensure users can only see
 * their own saved tones (RLS policy from 0003).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { savedTones, amps, guitars, type AmpKnobSettings } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { ConfidenceBadge } from "@/components/result-card/confidence-badge";
import { AmpKnobs } from "@/components/result-card/amp-knobs";
import { PedalChain } from "@/components/result-card/pedal-chain";
import { PlayingTips } from "@/components/result-card/playing-tips";
import { MissingPedals } from "@/components/result-card/missing-pedals";
import { FeedbackButtons } from "@/components/result-card/feedback-buttons";
import type { AdaptTone, ResearchTone } from "@/lib/llm/api-schemas";

export const dynamic = "force-dynamic";   // user-specific, no caching

interface Params {
  params: Promise<{ id: string }>;
}

export default async function ResultPage({ params }: Params) {
  const session = await getSession();
  if (!session) notFound();

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const rows = await db
    .select()
    .from(savedTones)
    .where(and(eq(savedTones.id, id), eq(savedTones.userId, session.authId)))
    .limit(1);
  const tone = rows[0];
  if (!tone) notFound();

  const research = tone.researchResponse as ResearchTone | null;
  const adapted = tone.adaptedSettings as AdaptTone;
  const userGearSnap = tone.userGearSnapshot as {
    guitarId?: number | null;
    ampId?: number | null;
    multiFxId?: number | null;
  } | null;

  // Fetch labels + knob_layout for display
  const [userAmpRow, userGuitarRow] = await Promise.all([
    userGearSnap?.ampId
      ? db.select().from(amps).where(eq(amps.id, userGearSnap.ampId)).limit(1)
      : userGearSnap?.multiFxId
        ? db.select().from(amps).where(eq(amps.id, userGearSnap.multiFxId)).limit(1)
        : Promise.resolve([]),
    userGearSnap?.guitarId
      ? db.select().from(guitars).where(eq(guitars.id, userGearSnap.guitarId)).limit(1)
      : Promise.resolve([]),
  ]);
  const userAmp = userAmpRow[0];
  const userGuitar = userGuitarRow[0];

  return (
    <div className="flex flex-1 justify-center px-6 py-10">
      <article className="w-full max-w-3xl flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <ConfidenceBadge
                mode={research?.mode ?? "speculative"}
                confidence={adapted.confidence}
              />
              {research?.section && (
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  {research.section}
                </span>
              )}
              {research?.tone_type && (
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  · {research.tone_type}
                </span>
              )}
            </div>
            <FeedbackButtons savedToneId={tone.id} initialRating={tone.feedback as -1 | 0 | 1 | undefined} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {tone.songQuery}
            <span className="text-zinc-500"> — {tone.artistQuery}</span>
          </h1>
          {research?.song_context && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-prose">
              {research.song_context}
            </p>
          )}
        </header>

        <AmpKnobs
          values={adapted.adapted_settings as AmpKnobSettings}
          layout={userAmp?.knobLayout ?? null}
          ampLabel={userAmp ? `${userAmp.brand} ${userAmp.model}` : null}
        />

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Guitar controls
          </h3>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-xs uppercase tracking-wide text-zinc-500">Pickup</span>{" "}
              <span className="font-semibold">{adapted.adapted_pickup_choice}</span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-zinc-500">Volume</span>{" "}
              <span className="font-semibold">{adapted.adapted_guitar_knobs.volume}</span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-zinc-500">Tone</span>{" "}
              <span className="font-semibold">{adapted.adapted_guitar_knobs.tone}</span>
            </div>
          </div>
        </section>

        <PedalChain
          pedals={adapted.adapted_pedals}
          guitarLabel={userGuitar ? `${userGuitar.brand} ${userGuitar.model}` : null}
          ampLabel={userAmp ? `${userAmp.brand} ${userAmp.model}` : null}
        />

        <MissingPedals pedals={adapted.missing_pedals} />

        <PlayingTips tips={adapted.playing_tips} notes={adapted.adaptation_notes} />

        <footer className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-6">
          <Link
            href="/search"
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Try another song
          </Link>
          <Link
            href="/library"
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Saved tones →
          </Link>
        </footer>
      </article>
    </div>
  );
}
