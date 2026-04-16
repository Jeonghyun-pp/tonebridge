/**
 * Pedals from the original tone that the user does NOT own.
 *
 * Showing this as a separate, downplayed section keeps it useful (the user
 * can see what's missing and consider buying) without making the main result
 * feel "broken" because you're a few pedals short. ToneAdapt collapses this
 * info into the chain — splitting it is a UX differentiator.
 */
import { ShoppingCart } from "lucide-react";

export interface MissingPedal {
  original_pedal: string;
  category: string;
  recommendation: string;
}

interface Props {
  pedals: MissingPedal[];
}

export function MissingPedals({ pedals }: Props) {
  if (pedals.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
        <ShoppingCart className="h-4 w-4" aria-hidden /> Pedals you don&apos;t have
      </h3>
      <ul className="flex flex-col gap-2">
        {pedals.map((p, i) => (
          <li
            key={i}
            className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{p.original_pedal}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                {p.category}
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{p.recommendation}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
