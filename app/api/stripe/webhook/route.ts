/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook receiver. Verifies signature against STRIPE_WEBHOOK_SECRET
 * then mutates `users` based on event type.
 *
 * Events handled:
 *   checkout.session.completed         user paid → mark Pro
 *   customer.subscription.updated      renewal / status change → sync tier
 *   customer.subscription.deleted      cancelled → demote to Free
 *
 * Always returns 200 even on no-op events; Stripe retries 4xx/5xx so we
 * only return non-2xx for genuine processing failures (signature, DB error).
 *
 * Master plan §9.2.
 */
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "verify_failed";
    return NextResponse.json({ error: `signature_invalid: ${msg}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // Other events (invoice.*, payment_intent.*, etc.) are ignored for now.
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe/webhook] processing failed:", msg);
    return NextResponse.json({ error: "processing_failed", message: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// =============================================================================
// Handlers
// =============================================================================

async function handleCheckoutCompleted(s: Stripe.Checkout.Session) {
  const userId =
    s.client_reference_id ?? (s.metadata && (s.metadata.app_user_id as string | undefined));
  if (!userId) {
    console.warn("[stripe/webhook] checkout.completed without app_user_id; skipping");
    return;
  }
  const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
  const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;

  await db
    .update(users)
    .set({
      subscriptionTier: "pro",
      subscriptionStatus: "active",
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subId ?? undefined,
    })
    .where(eq(users.id, userId));
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const userId = (sub.metadata?.app_user_id as string | undefined) ?? null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Resolve user — prefer metadata, fall back to customer lookup
  const target = userId
    ? userId
    : (await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId)).limit(1))[0]?.id;
  if (!target) {
    console.warn(`[stripe/webhook] subscription event for unknown customer ${customerId}`);
    return;
  }

  // Active-ish statuses keep the user on Pro; everything else demotes.
  const tier =
    sub.status === "active" || sub.status === "trialing" || sub.status === "past_due"
      ? "pro"
      : "free";

  await db
    .update(users)
    .set({
      subscriptionTier: tier,
      subscriptionStatus: sub.status,
      stripeSubscriptionId: sub.id,
    })
    .where(eq(users.id, target));
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const userId = (sub.metadata?.app_user_id as string | undefined) ?? null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const target = userId
    ? userId
    : (await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId)).limit(1))[0]?.id;
  if (!target) return;

  await db
    .update(users)
    .set({
      subscriptionTier: "free",
      subscriptionStatus: sub.status,
      stripeSubscriptionId: null,
    })
    .where(eq(users.id, target));
}

// Suppress unused import warning — we may need admin client for future webhook
// signature secret rotation jobs.
void createAdminClient;
