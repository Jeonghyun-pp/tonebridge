"use client";

/**
 * Onboarding step 1 — How did you hear about us?
 *
 * The data is purely for marketing analytics — we don't gate anything on it.
 * That's why "Other" + a free text input is acceptable; the structured choices
 * just give us a histogram for the common channels.
 */
import { useState } from "react";
import { StepShell } from "./step-shell";

const CHOICES = [
  "Reddit / r/guitar",
  "TikTok or Instagram",
  "YouTube tutorial",
  "Friend or bandmate",
  "Google search",
  "Guitar forum",
  "Product Hunt / Show HN",
  "Other",
];

export interface ReferralStepProps {
  initial?: string | null;
  onSubmit: (referral: string | null) => void;
}

export function ReferralStep({ initial, onSubmit }: ReferralStepProps) {
  const [choice, setChoice] = useState<string | null>(initial ?? null);
  const [other, setOther] = useState("");

  const finalValue = choice === "Other" ? other.trim() || null : choice;

  return (
    <StepShell
      step={1}
      totalSteps={3}
      title="How did you hear about ToneBridge?"
      subtitle="One question, then we'll get you set up."
      footer={
        <button
          type="button"
          onClick={() => onSubmit(finalValue)}
          disabled={!choice || (choice === "Other" && !other.trim())}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
        >
          Continue
        </button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChoice(c)}
            className={`text-left rounded-md border px-3 py-2 text-sm transition-colors ${
              choice === c
                ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {choice === "Other" && (
        <input
          type="text"
          autoFocus
          value={other}
          onChange={(e) => setOther(e.target.value)}
          maxLength={120}
          placeholder="Tell us where (optional)"
          className="mt-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
        />
      )}
    </StepShell>
  );
}
