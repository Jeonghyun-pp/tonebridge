/**
 * POST /api/feedback
 *
 * Records a 👍 / 👎 rating on a saved tone, and triggers automatic mode
 * downgrade when 👎 accumulates ≥3 within the 30-day window for a given
 * reference_tone (Master plan §6.6.9 — Zero-Human feedback loop).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { feedbackEvents, referenceTones, savedTones } from "@/lib/db/schema";
import { feedbackLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const BodySchema = z.object({
  savedToneId: z.number().int().positive(),
  rating: z.number().int().min(-1).max(1),
  comment: z.string().max(1000).optional(),
});

const DOWNGRADE_THRESHOLD = 3;
const WINDOW_DAYS = 30;

export async function POST(req: NextRequest) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const rl = await feedbackLimit.limit(user.id);
  if (!rl.success) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const { savedToneId, rating, comment } = parsed.data;

  // Verify ownership of the saved tone (RLS would catch this too, but explicit
  // check yields a clearer 403 than RLS's empty-result swallow).
  const owned = await db
    .select({ id: savedTones.id, referenceToneId: savedTones.referenceToneId })
    .from(savedTones)
    .where(and(eq(savedTones.id, savedToneId), eq(savedTones.userId, user.id)))
    .limit(1);
  if (owned.length === 0) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  await db.insert(feedbackEvents).values({
    userId: user.id,
    savedToneId,
    referenceToneId: owned[0].referenceToneId,
    rating,
    comment,
  });

  // Automatic downgrade when 👎 piles up on the same reference_tone.
  let downgraded = false;
  if (rating === -1 && owned[0].referenceToneId) {
    const refId = owned[0].referenceToneId;
    const cutoff = sql`now() - interval '${sql.raw(`${WINDOW_DAYS} days`)}'`;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackEvents)
      .where(
        and(
          eq(feedbackEvents.referenceToneId, refId),
          eq(feedbackEvents.rating, -1),
          sql`${feedbackEvents.createdAt} > ${cutoff}`
        )
      );

    if (Number(count) >= DOWNGRADE_THRESHOLD) {
      await db
        .update(referenceTones)
        .set({
          mode: sql`CASE
            WHEN ${referenceTones.mode} = 'authoritative' THEN 'inferred'::tone_mode
            WHEN ${referenceTones.mode} = 'inferred' THEN 'speculative'::tone_mode
            ELSE ${referenceTones.mode}
          END`,
          confidence: sql`GREATEST(0.2, COALESCE(${referenceTones.confidence}, 0) - 0.3)`,
          updatedAt: new Date(),
        })
        .where(eq(referenceTones.id, refId));
      downgraded = true;
    }
  }

  return NextResponse.json({ ok: true, downgraded });
}
