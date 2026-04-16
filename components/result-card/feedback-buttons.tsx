"use client";

/**
 * 👍 / 👎 inline feedback buttons. Single-vote: clicking again toggles back to neutral.
 *
 * 👎 may trigger automatic mode downgrade on the underlying reference_tone
 * (Master plan §6.6.9) — we display a discreet "thanks, we'll re-check this"
 * note so users see their feedback was acknowledged.
 */
import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface Props {
  savedToneId: number;
  initialRating?: -1 | 0 | 1;
}

export function FeedbackButtons({ savedToneId, initialRating = 0 }: Props) {
  const [rating, setRating] = useState<-1 | 0 | 1>(initialRating);
  const [pending, setPending] = useState(false);
  const [downgraded, setDowngraded] = useState(false);

  async function vote(value: -1 | 1) {
    if (pending) return;
    setPending(true);
    const newValue = rating === value ? 0 : value;
    setRating(newValue);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedToneId, rating: newValue }),
      });
      const json = await res.json();
      if (json.downgraded) setDowngraded(true);
    } catch {
      // Revert on network error
      setRating(rating);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void vote(1)}
        aria-pressed={rating === 1}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
          rating === 1
            ? "border-green-600 bg-green-50 dark:bg-green-950/50 text-green-800 dark:text-green-300"
            : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        }`}
      >
        <ThumbsUp className="h-4 w-4" />
        Helpful
      </button>
      <button
        type="button"
        onClick={() => void vote(-1)}
        aria-pressed={rating === -1}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
          rating === -1
            ? "border-red-600 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300"
            : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        }`}
      >
        <ThumbsDown className="h-4 w-4" />
        Off
      </button>
      {downgraded && (
        <span className="text-xs text-zinc-500" role="status">
          Thanks — we&apos;ve flagged this tone for re-check.
        </span>
      )}
    </div>
  );
}
