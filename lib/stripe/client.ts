/**
 * Stripe SDK singleton.
 *
 * apiVersion is omitted on purpose — the installed Stripe SDK pins to a
 * compatible version automatically. Pinning here just creates a maintenance
 * burden without practical benefit (we don't have legacy webhook handlers
 * that need a specific version's payload shape).
 */
import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    typescript: true,
  });
  return _stripe;
}

/** Pricing constants — overridable via env so prod / staging can use different price IDs. */
export const PRO_MONTHLY_PRICE_ID = process.env.STRIPE_PRICE_ID_PRO_MONTHLY ?? "";

export const PRICING = {
  pro_monthly: {
    priceId: PRO_MONTHLY_PRICE_ID,
    label: "Pro · monthly",
    priceDisplay: "$5.99",
    cadence: "month",
    dailyCredits: 200,
  },
} as const;
