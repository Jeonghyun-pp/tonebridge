"use client";

/**
 * Onboarding orchestration. State machine: 1 → 2 → 3 → submit → /search.
 *
 * Three steps mirror the order the user observed in ToneAdapt:
 *   1. How did you hear about us? (referral source)
 *   2. Pick your guitar
 *   3. Pick your amp OR multi-FX
 *
 * Master plan §10.1 + S11 spec.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReferralStep } from "@/components/onboarding/referral-question";
import { GuitarStep } from "@/components/onboarding/guitar-step";
import { AmpMultiFxStep, type AmpPick } from "@/components/onboarding/amp-multifx-step";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [referral, setReferral] = useState<string | null>(null);
  const [guitar, setGuitar] = useState<{ id: number | null; freetext: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(amp: AmpPick) {
    if (!guitar) return;       // shouldn't be possible at this point
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/gear-onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referral, guitar, amp }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }
      router.push("/search");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-900">
          {error}
        </div>
      )}

      {step === 1 && (
        <ReferralStep
          initial={referral}
          onSubmit={(r) => {
            setReferral(r);
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <GuitarStep
          onBack={() => setStep(1)}
          onSubmit={(g) => {
            setGuitar(g);
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <AmpMultiFxStep
          onBack={() => setStep(2)}
          onSubmit={(amp) => void finish(amp)}
        />
      )}

      {submitting && (
        <p role="status" className="text-center text-sm text-zinc-500 pb-8">
          Saving your rig…
        </p>
      )}
    </>
  );
}
