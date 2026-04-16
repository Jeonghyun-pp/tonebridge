/**
 * /pricing  — public Pricing page.
 *
 * Server Component that lightly customizes for signed-in users (shows
 * "Manage subscription" instead of "Upgrade" when already Pro). Heavy
 * lifting happens in the Client island UpgradeButton.
 */
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { UpgradeButton } from "@/components/upgrade-button";
import { Check } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await getSession();
  const isPro = session?.profile.subscriptionTier === "pro";

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-4xl flex flex-col gap-10">
        <header className="flex flex-col gap-2 text-center">
          <span className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
            ToneBridge
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">Pick a plan</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            All plans include verified-source badges, signal-chain visualization, and
            confidence-aware recommendations.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PlanCard
            name="Free"
            price="$0"
            cadence="forever"
            features={[
              "3 tones per day",
              "Catalog of 1,500+ verified + inferred songs",
              "Confidence badges",
              "Save tones to your library",
            ]}
            cta={
              session ? (
                isPro ? null : (
                  <Link
                    href="/search"
                    className="rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 inline-block"
                  >
                    Continue with Free
                  </Link>
                )
              ) : (
                <Link
                  href="/auth/signin?redirect=/search"
                  className="rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 inline-block"
                >
                  Sign up free
                </Link>
              )
            }
          />

          <PlanCard
            name="Pro"
            price="$5.99"
            cadence="month"
            highlight
            features={[
              "200 tones per day",
              "Lazy-cache enrichment of any song",
              "Higher Stage 2 quality (multi-LLM consensus)",
              "Bass guitar tones (M2+)",
              "Priority support",
            ]}
            cta={
              !session ? (
                <Link
                  href="/auth/signin?redirect=/pricing"
                  className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-90 inline-block"
                >
                  Sign in to subscribe
                </Link>
              ) : isPro ? (
                <UpgradeButton mode="manage" />
              ) : (
                <UpgradeButton mode="checkout" />
              )
            }
          />
        </div>

        <p className="text-center text-xs text-zinc-500">
          Cancel any time from the customer portal. ToneBridge results are reasonable starting
          points — confidence badges help you decide how much to trust each.
        </p>
      </div>
    </main>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  cadence: string;
  features: string[];
  cta: React.ReactNode;
  highlight?: boolean;
}

function PlanCard({ name, price, cadence, features, cta, highlight }: PlanCardProps) {
  return (
    <div
      className={`flex flex-col gap-5 rounded-lg border p-6 ${
        highlight
          ? "border-zinc-900 dark:border-zinc-100 shadow-sm"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{name}</h2>
        {highlight && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900">
            Most popular
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">{price}</span>
        <span className="text-sm text-zinc-500">/ {cadence}</span>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div>{cta}</div>
    </div>
  );
}
