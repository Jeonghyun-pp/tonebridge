/**
 * GET /api/gear-onboarding/status
 *
 * Returns whether the user has finished onboarding and a snapshot of the
 * current default gear (used by the result/library pages to show "your rig").
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userGear } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const gearRows = await db
    .select()
    .from(userGear)
    .where(and(eq(userGear.userId, session.authId), eq(userGear.isDefault, true)))
    .limit(1);

  return NextResponse.json({
    ok: true,
    onboardingComplete: session.profile.onboardingComplete,
    referralSource: session.profile.referralSource,
    gear: gearRows[0] ?? null,
  });
}
