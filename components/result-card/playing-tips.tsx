import { Lightbulb } from "lucide-react";

interface Props {
  tips: string[];
  notes?: string;
}

export function PlayingTips({ tips, notes }: Props) {
  if (tips.length === 0 && !notes) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
        <Lightbulb className="h-4 w-4" aria-hidden /> Playing tips
      </h3>
      {tips.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          {tips.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-zinc-400" aria-hidden>·</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
      {notes && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100">
            Why these adjustments?
          </summary>
          <p className="pt-2 leading-relaxed">{notes}</p>
        </details>
      )}
    </section>
  );
}
