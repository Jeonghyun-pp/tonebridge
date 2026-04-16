/**
 * POST /api/adapt-tone
 *
 * Stage 2 — given a Stage 1 research result + the caller's default user_gear,
 * translate to settings playable on the user's rig. Result is persisted to
 * saved_tones so the user can revisit it from /library.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { savedTones, userGear, usageLogs } from "@/lib/db/schema";
import { checkAndConsumeCredit } from "@/lib/credits";
import { adaptTone } from "@/lib/llm/adapt-tone";
import { ResearchToneSchema } from "@/lib/llm/api-schemas";
import { assertNoRawContent } from "@/lib/automation/storage-guard";

export const runtime = "nodejs";

const BodySchema = z.object({
  research: ResearchToneSchema,
  referenceToneId: z.number().int().nullable().optional(),
  songQuery: z.string().nullable().optional(),
  artistQuery: z.string().nullable().optional(),
  userTonePreference: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return jerr(401, "unauthorized");

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return jerr(400, "bad_request", { issues: parsed.error.issues });

  // Default user_gear
  const gearRows = await db
    .select()
    .from(userGear)
    .where(and(eq(userGear.userId, user.id), eq(userGear.isDefault, true)))
    .limit(1);
  const gear = gearRows[0];
  if (!gear) return jerr(400, "no_gear_onboarded");

  const credit = await checkAndConsumeCredit(user.id);
  if (!credit.ok) return jerr(creditStatus(credit.reason), credit.reason, credit);

  try {
    const r = await adaptTone({
      research: parsed.data.research,
      userGuitarId: gear.guitarId,
      userAmpId: gear.ampId,
      userMultiFxId: gear.multiFxId,
      userPedalIds: gear.pedals ?? [],
      userTonePreference: parsed.data.userTonePreference ?? undefined,
    });

    const insertRow = {
      userId: user.id,
      referenceToneId: parsed.data.referenceToneId ?? null,
      songQuery: parsed.data.songQuery ?? parsed.data.research.song,
      artistQuery: parsed.data.artistQuery ?? parsed.data.research.artist,
      adaptedSettings: r.data,
      userGearSnapshot: gear,
      researchResponse: parsed.data.research,
    };
    assertNoRawContent(insertRow);

    const [saved] = await db.insert(savedTones).values(insertRow).returning({ id: savedTones.id });

    await logUsage({
      userId: user.id, endpoint: "/api/adapt-tone",
      model: r.model, promptTokens: r.usage.in, completionTokens: r.usage.out,
      costUsd: r.costUsd, latencyMs: Date.now() - start,
    });

    return NextResponse.json({ ok: true, data: r.data, savedToneId: saved.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logUsage({
      userId: user.id, endpoint: "/api/adapt-tone",
      latencyMs: Date.now() - start, success: false, error: msg,
    });
    return jerr(500, "adaptation_failed", { message: msg });
  }
}

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
      success: args.success ?? true,
      error: args.error,
    });
  } catch {
    /* never fail user request because logging failed */
  }
}
