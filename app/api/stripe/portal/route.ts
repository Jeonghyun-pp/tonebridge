/**
 * POST /api/stripe/portal
 *
 * Returns a Customer Portal URL where the user can manage their subscription
 * (change card, view invoices, cancel). No-op if the user has no Stripe
 * customer record.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { stripe } from "@/lib/stripe/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (!session.profile.stripeCustomerId) {
    return NextResponse.json(
      { ok: false, error: "no_subscription" },
      { status: 400 }
    );
  }

  const portal = await stripe().billingPortal.sessions.create({
    customer: session.profile.stripeCustomerId,
    return_url: `${req.nextUrl.origin}/library`,
  });

  return NextResponse.json({ ok: true, url: portal.url });
}
