"use client";

import { useState } from "react";
import { StepShell } from "./step-shell";
import { GearSearch } from "./gear-search";

export interface AmpPick {
  ampId: number | null;
  multiFxId: number | null;
  freetext: string | null;
}

export interface AmpMultiFxStepProps {
  onBack: () => void;
  onSubmit: (pick: AmpPick) => void;
}

type Tab = "amp" | "multi_fx";

export function AmpMultiFxStep({ onBack, onSubmit }: AmpMultiFxStepProps) {
  const [tab, setTab] = useState<Tab>("amp");
  const [pick, setPick] = useState<{
    id: number | null;
    freetext: string | null;
    label: string;
  } | null>(null);

  function build(): AmpPick {
    if (!pick) return { ampId: null, multiFxId: null, freetext: null };
    if (tab === "multi_fx") {
      return { ampId: null, multiFxId: pick.id, freetext: pick.id ? null : pick.freetext };
    }
    return { ampId: pick.id, multiFxId: null, freetext: pick.id ? null : pick.freetext };
  }

  return (
    <StepShell
      step={3}
      totalSteps={3}
      title="What amp or modeler do you use?"
      subtitle="A real amp or a multi-FX modeler — both work for tone translation."
      onBack={onBack}
      footer={
        <button
          type="button"
          onClick={() => onSubmit(build())}
          disabled={!pick}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
        >
          Finish
        </button>
      }
    >
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        <TabButton active={tab === "amp"} onClick={() => { setTab("amp"); setPick(null); }}>
          Tube / SS Amp
        </TabButton>
        <TabButton active={tab === "multi_fx"} onClick={() => { setTab("multi_fx"); setPick(null); }}>
          Multi-FX (Helix / Kemper / Axe-FX)
        </TabButton>
      </div>

      <GearSearch
        key={tab}                   // remount on tab switch to clear state
        endpoint={`/api/amps/lookup?modelers=${tab === "multi_fx"}`}
        placeholder={
          tab === "multi_fx"
            ? "Search Line 6 Helix, Kemper, Axe-FX III…"
            : "Search Marshall JCM800, Mesa Rectifier, Fender Twin…"
        }
        itemBadge={(it) => (it.voicing as string | null) ?? null}
        onSelect={(p) => setPick(p)}
      />

      {pick && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Selected: <span className="font-medium text-zinc-900 dark:text-zinc-100">{pick.label}</span>
          {pick.id === null && (
            <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
              (manual — voicing details may be limited)
            </span>
          )}
        </p>
      )}
    </StepShell>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
        active
          ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
