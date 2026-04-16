/**
 * Per-user rate limiting via Upstash Redis.
 *
 * Master plan §8.1 — credits cap daily quota; this caps burst rate so a
 * misbehaving client can't drain a user's daily allowance in seconds.
 *
 * Limits:
 *   research-tone   10 req / 60s sliding   (matches Tier A user typical pace)
 *   adapt-tone      10 req / 60s sliding
 *   feedback        20 req / 60s
 *
 * When UPSTASH_REDIS_REST_URL is unset (local dev without Redis), we
 * substitute a no-op limiter so dev flow never blocks. Production must set it.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

interface Limiter {
  limit: (key: string) => Promise<{ success: boolean; remaining: number; reset: number }>;
}

function build(window: string, limit: number, prefix: string): Limiter {
  if (!redis) {
    return {
      async limit() {
        return { success: true, remaining: 999, reset: Date.now() + 60_000 };
      },
    };
  }
  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window as Parameters<typeof Ratelimit.slidingWindow>[1]),
    prefix: `tonebridge:rl:${prefix}`,
    analytics: false,
  });
  return {
    async limit(key: string) {
      const r = await rl.limit(key);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    },
  };
}

export const researchToneLimit = build("60 s", 10, "research");
export const adaptToneLimit = build("60 s", 10, "adapt");
export const feedbackLimit = build("60 s", 20, "feedback");
export const lookupLimit = build("60 s", 60, "lookup");

/** Default — used by checkAndConsumeCredit's per-call burst guard. */
export const ratelimit = researchToneLimit;
