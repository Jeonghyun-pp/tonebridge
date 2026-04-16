"use client";

import { useState } from "react";
import { StepShell } from "./step-shell";
import { GearSearch } from "./gear-search";

export interface GuitarStepProps {
  onBack: () => void;
  onSubmit: (pick: { id: number | null; freetext: string | null }) => void;
}

export function GuitarStep({ onBack, onSubmit }: GuitarStepProps) {
  const [pick, setPick] = useState<{
    id: number | null;
    freetext: string | null;
    label: string;
  } | null>(null);

  return (
    <StepShell
      step={2}
      totalSteps={3}
      title="What guitar do you play most?"
      subtitle="We'll use its pickup type to translate tones to your rig."
      onBack={onBack}
      footer={
        <button
          type="button"
          onClick={() => pick && onSubmit({ id: pick.id, freetext: pick.freetext })}
          disabled={!pick}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
        >
          Continue
        </button>
      }
    >
      <GearSearch
        endpoint="/api/guitars/lookup"
        placeholder="Search Stratocaster, Les Paul, Ibanez RG…"
        itemBadge={(it) => (it.pickupConfig as string | null) ?? null}
        onSelect={(p) => setPick(p)}
      />
      {pick && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Selected: <span className="font-medium text-zinc-900 dark:text-zinc-100">{pick.label}</span>
          {pick.id === null && (
            <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
              (manual — we&apos;ll guess pickups from the model)
            </span>
          )}
        </p>
      )}
    </StepShell>
  );
}
