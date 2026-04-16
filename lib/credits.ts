/**
 * Daily credit gating per user, plus burst rate-limit.
 *
 * Master plan §8.1.
 *
 * The atomic-ish update uses a CASE expression to reset the counter when the
 * date has rolled over without a separate read-then-write race. Postgres
 * isolation under default READ COMMITTED is sufficient: even with two parallel
 * requests, the worst case is one of them sees an outdated count and over-counts
 * by 1 — never under-counts (which would be a real bypass).
 */
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { researchToneLimit } from "@/lib/ratelimit";

export const DAILY_LIMITS = { free: 3, pro: 200 } as const;

export type CreditsResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "limit_exceeded"; canUpgrade: boolean }
  | { ok: false; reason: "rate_limited"; resetAt: number }
  | { ok: false; reason: "unauthorized" };

export async function checkAndConsumeCredit(userId: string): Promise<CreditsResult> {
  // Burst guard first — cheap; protects DB from runaway loops.
  const rl = await researchToneLimit.limit(userId);
  if (!rl.success) return { ok: false, reason: "rate_limited", resetAt: rl.reset };

  const today = new Date().toISOString().slice(0, 10);

  // Atomic-ish increment with same-day reset.
  // Returns the row AFTER the update so we can read the new daily_credits_used.
  const updated = await db
    .update(users)
    .set({
      dailyCreditsUsed: sql`CASE
        WHEN ${users.dailyCreditsResetAt} = ${today}::date
          THEN ${users.dailyCreditsUsed} + 1
        ELSE 1
      END`,
      dailyCreditsResetAt: sql`${today}::date`,
    })
    .where(eq(users.id, userId))
    .returning({
      newCount: users.dailyCreditsUsed,
      tier: users.subscriptionTier,
    });

  if (updated.length === 0) return { ok: false, reason: "unauthorized" };

  const { newCount, tier } = updated[0];
  const limit = DAILY_LIMITS[tier as keyof typeof DAILY_LIMITS];

  if (newCount > limit) {
    // Over-limit: roll back this consumption so the user retains exactly `limit` for today.
    await db
      .update(users)
      .set({ dailyCreditsUsed: limit })
      .where(eq(users.id, userId));
    return { ok: false, reason: "limit_exceeded", canUpgrade: tier === "free" };
  }

  return { ok: true, remaining: Math.max(0, limit - newCount) };
}

/**
 * Read-only check (for showing remaining credits in the UI without consuming).
 */
export async function getRemainingCredits(
  userId: string
): Promise<{ used: number; limit: number; resetAt: string }> {
  const rows = await db
    .select({
      used: users.dailyCreditsUsed,
      resetAt: users.dailyCreditsResetAt,
      tier: users.subscriptionTier,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) {
    return { used: 0, limit: DAILY_LIMITS.free, resetAt: new Date().toISOString().slice(0, 10) };
  }

  const today = new Date().toISOString().slice(0, 10);
  const r = rows[0];
  const usedToday = String(r.resetAt) === today ? r.used : 0;
  const limit = DAILY_LIMITS[r.tier as keyof typeof DAILY_LIMITS];
  return { used: usedToday, limit, resetAt: today };
}
