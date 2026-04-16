"use client";

/**
 * Header widget — fetches /api/credits, shows X / N + an Upgrade link
 * when on Free. Polls every 30s so a Stripe checkout completion shows up
 * without a full page reload.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

interface CreditsState {
  used: number;
  limit: number;
  tier: "free" | "pro";
}

export function CreditsDisplay() {
  const [state, setState] = useState<CreditsState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.ok) {
          setState({ used: json.used, limit: json.limit, tier: json.tier });
        }
      } catch {
        /* ignore — header widget is non-critical */
      }
    }
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!state) return null;

  const remaining = Math.max(0, state.limit - state.used);
  const exhausted = remaining === 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`tabular-nums ${exhausted ? "text-red-700 dark:text-red-400" : "text-zinc-500"}`}
        aria-label={`${state.used} of ${state.limit} credits used today`}
      >
        {state.used}/{state.limit} today
      </span>
      {state.tier === "free" && (
        <Link
          href="/pricing"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          Upgrade
        </Link>
      )}
    </div>
  );
}
