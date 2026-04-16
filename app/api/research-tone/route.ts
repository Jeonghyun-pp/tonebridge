/**
 * POST /api/research-tone
 *
 * Stage 1 — given (song, artist, section, toneType), produce a reference tone.
 * Resolution order:
 *   1. reference_tones table (curated/Tier A)  — return immediately
 *   2. research_cache table (lazy generated)   — return + bump hit_count
 *   3. live researchTone() LLM call             — generate, cache, return
 *
 * Consumes one daily credit per request, even on cache hits — caller
 * intent is "I want a recommendation", and counting cache reads keeps
 * abuse symmetric with cache misses.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { referenceTones, researchCache, usageLogs } from "@/lib/db/schema";
import { checkAndConsumeCredit } from "@/lib/credits";
import { researchTone } from "@/lib/llm/research-tone";
import { assertNoRawContent } from "@/lib/automation/storage-guard";

export const runtime = "nodejs";

const BodySchema = z.object({
  song: z.string().min(1).max(200),
  artist: z.string().min(1).max(200),
  section: z
    .enum(["intro", "verse", "chorus", "riff", "solo", "bridge", "outro", "clean_intro"])
    .optional(),
  toneType: z
    .enum(["clean", "crunch", "distorted", "high_gain", "ambient", "acoustic"])
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return jerr(401, "unauthorized");

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return jerr(400, "bad_request", { issues: parsed.error.issues });
  const { song, artist, section = "riff", toneType = null } = parsed.data;

  // -------- 1) Tier A hit (curated reference_tones) --------
  const tierA = await db
    .select()
    .from(referenceTones)
    .where(
      and(
        sql`lower(${referenceTones.song}) = lower(${song})`,
        sql`lower(${referenceTones.artist}) = lower(${artist})`,
        eq(referenceTones.section, section)
      )
    )
    .limit(1);

  if (tierA[0]) {
    const credit = await checkAndConsumeCredit(user.id);
    if (!credit.ok) return jerr(creditStatus(credit.reason), credit.reason, credit);
    await logUsage({
      userId: user.id, endpoint: "/api/research-tone",
      latencyMs: Date.now() - start, cacheHit: true, mode: tierA[0].mode,
    });
    return NextResponse.json({
      ok: true, data: tierA[0], cached: true, source: "tier_a", mode: tierA[0].mode,
    });
  }

  // -------- 2) Lazy cache hit (research_cache) --------
  const cached = await db
    .select()
    .from(researchCache)
    .where(
      and(
        sql`lower(${researchCache.song}) = lower(${song})`,
        sql`lower(${researchCache.artist}) = lower(${artist})`,
        eq(researchCache.section, section),
        toneType
          ? eq(researchCache.toneType, toneType)
          : sql`${researchCache.toneType} IS NULL`
      )
    )
    .limit(1);

  if (cached[0]) {
    const credit = await checkAndConsumeCredit(user.id);
    if (!credit.ok) return jerr(creditStatus(credit.reason), credit.reason, credit);
    await db
      .update(researchCache)
      .set({ hitCount: sql`${researchCache.hitCount} + 1` })
      .where(eq(researchCache.id, cached[0].id));
    await logUsage({
      userId: user.id, endpoint: "/api/research-tone",
      latencyMs: Date.now() - start, cacheHit: true,
    });
    return NextResponse.json({
      ok: true, data: cached[0].result, cached: true, source: "lazy_cache",
    });
  }

  // -------- 3) Generate fresh --------
  const credit = await checkAndConsumeCredit(user.id);
  if (!credit.ok) return jerr(creditStatus(credit.reason), credit.reason, credit);

  try {
    const r = await researchTone({ song, artist, section, toneType });
    const row = {
      song, artist, section, toneType,
      result: r.data,
    };
    assertNoRawContent(row);
    await db.insert(researchCache).values(row).onConflictDoNothing();

    await logUsage({
      userId: user.id, endpoint: "/api/research-tone",
      model: r.model, promptTokens: r.usage.in, completionTokens: r.usage.out,
      costUsd: r.costUsd, latencyMs: Date.now() - start, mode: r.data.mode,
    });

    return NextResponse.json({
      ok: true, data: r.data, cached: false, source: "live", mode: r.data.mode,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logUsage({
      userId: user.id, endpoint: "/api/research-tone",
      latencyMs: Date.now() - start, success: false, error: msg,
    });
    return jerr(500, "generation_failed", { message: msg });
  }
}

// =============================================================================
// helpers
// =============================================================================
function jerr(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function creditStatus(reason: string): number {
  return reason === "unauthorized" ? 401 : 429;
}

async function logUsage(args: {
  userId: string;
  endpoint: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  latencyMs: number;
  cacheHit?: boolean;
  mode?: "authoritative" | "inferred" | "speculative";
  success?: boolean;
  error?: string;
}) {
  try {
    await db.insert(usageLogs).values({
      userId: args.userId,
      endpoint: args.endpoint,
      model: args.model,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      costUsd: args.costUsd?.toFixed(6),
      latencyMs: args.latencyMs,
      cacheHit: args.cacheHit ?? false,
      mode: args.mode,
      success: args.success ?? true,
      error: args.error,
    });
  } catch {
    // Never fail the user's request because logging failed.
  }
}
