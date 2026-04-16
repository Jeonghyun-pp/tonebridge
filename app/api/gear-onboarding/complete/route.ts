/**
 * POST /api/gear-onboarding/complete
 *
 * Final step of onboarding — creates the user_gear row and marks the user
 * as onboarded. Idempotent: re-posting overwrites the existing default.
 *
 * Master plan §10.1.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { userGear, users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const GearPickSchema = z.object({
  id: z.number().int().positive().nullable(),
  freetext: z.string().max(120).nullable(),
});

const BodySchema = z.object({
  referral: z.string().max(120).nullable(),
  guitar: GearPickSchema,
  amp: z.object({
    ampId: z.number().int().positive().nullable(),
    multiFxId: z.number().int().positive().nullable(),
    freetext: z.string().max(120).nullable(),
  }),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { referral, guitar, amp } = parsed.data;

  // At minimum we need either an amp or a multi-fx unit to do Stage 2 translation.
  if (amp.ampId === null && amp.multiFxId === null && !amp.freetext) {
    return NextResponse.json({ ok: false, error: "need_amp_or_multifx" }, { status: 400 });
  }

  // Make sure no other row is marked default for this user (we only support
  // one default rig in MVP — multi-rig profiles are a post-launch concern).
  await db
    .update(userGear)
    .set({ isDefault: false })
    .where(and(eq(userGear.userId, session.authId), eq(userGear.isDefault, true)));

  await db.insert(userGear).values({
    userId: session.authId,
    guitarId: guitar.id,
    guitarFreetext: guitar.freetext,
    ampId: amp.ampId,
    ampFreetext: amp.freetext,
    multiFxId: amp.multiFxId,
    pedals: [],
    pedalFreetext: [],
    isDefault: true,
  });

  await db
    .update(users)
    .set({
      onboardingComplete: true,
      referralSource: referral ?? session.profile.referralSource,
    })
    .where(eq(users.id, session.authId));

  return NextResponse.json({ ok: true });
}
