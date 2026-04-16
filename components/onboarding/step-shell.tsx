"use client";

/**
 * Visual frame for each onboarding step. Centralizes spacing, the progress
 * pip strip, and the Back/Next button slot so the three step components
 * can focus on their unique inputs.
 */
import { ChevronLeft } from "lucide-react";

export interface StepShellProps {
  step: number;       // 1-based current step
  totalSteps: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function StepShell({ step, totalSteps, title, subtitle, onBack, children, footer }: StepShellProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl flex flex-col gap-8">
        {/* Progress dots */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            disabled={!onBack}
            aria-label="Previous step"
            className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:invisible"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                aria-current={i + 1 === step ? "step" : undefined}
                className={`h-1.5 rounded-full transition-all ${
                  i + 1 === step
                    ? "w-6 bg-zinc-900 dark:bg-zinc-100"
                    : i + 1 < step
                      ? "w-3 bg-zinc-900/60 dark:bg-zinc-100/60"
                      : "w-3 bg-zinc-300 dark:bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-zinc-500 tabular-nums">
            {step} / {totalSteps}
          </span>
        </div>

        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>}
        </header>

        <div className="flex flex-col gap-4">{children}</div>

        {footer && <div className="flex justify-end gap-2 pt-2">{footer}</div>}
      </div>
    </div>
  );
}
