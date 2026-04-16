/**
 * GET /api/credits
 *
 * Read-only credits status — used by the header widget to show
 * "X / N today". Doesn't consume a credit.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRemainingCredits, DAILY_LIMITS } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const status = await getRemainingCredits(session.authId);
  return NextResponse.json({
    ok: true,
    used: status.used,
    limit: status.limit,
    tier: session.profile.subscriptionTier,
    pro: session.profile.subscriptionTier === "pro",
    proLimit: DAILY_LIMITS.pro,
  });
}
