"use client";

/**
 * Client-side button for the two Stripe flows:
 *   mode="checkout"  POST /api/stripe/checkout → redirect to Stripe-hosted Checkout
 *   mode="manage"    POST /api/stripe/portal   → redirect to Stripe Customer Portal
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  mode: "checkout" | "manage";
}

export function UpgradeButton({ mode }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const endpoint = mode === "checkout" ? "/api/stripe/checkout" : "/api/stripe/portal";
      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.url) {
        setError(json.error ?? "Couldn't open Stripe.");
        setLoading(false);
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void go()}
        disabled={loading}
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === "checkout" ? "Upgrade to Pro" : "Manage subscription"}
      </button>
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}
