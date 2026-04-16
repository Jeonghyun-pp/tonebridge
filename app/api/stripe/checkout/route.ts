/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for Pro monthly. Returns the redirect URL.
 *
 * - Looks up or creates a Stripe customer mapped to the auth user
 * - client_reference_id = user.id so the webhook can map back without
 *   relying on customer metadata
 * - allow_promotion_codes for early-launch promo support
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { stripe, PRO_MONTHLY_PRICE_ID } from "@/lib/stripe/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (!PRO_MONTHLY_PRICE_ID) {
    return NextResponse.json(
      { ok: false, error: "stripe_not_configured" },
      { status: 500 }
    );
  }

  const s = stripe();
  let customerId = session.profile.stripeCustomerId;

  if (!customerId) {
    const created = await s.customers.create({
      email: session.email ?? undefined,
      metadata: { app_user_id: session.authId },
    });
    customerId = created.id;
    await db
      .update(users)
      .set({ stripeCustomerId: customerId })
      .where(eq(users.id, session.authId));
  }

  const origin = req.nextUrl.origin;
  const checkout = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: session.authId,
    line_items: [{ price: PRO_MONTHLY_PRICE_ID, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${origin}/library?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
    subscription_data: {
      metadata: { app_user_id: session.authId },
    },
  });

  if (!checkout.url) {
    return NextResponse.json({ ok: false, error: "no_checkout_url" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: checkout.url });
}
