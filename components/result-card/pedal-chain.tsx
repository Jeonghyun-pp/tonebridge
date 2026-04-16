/**
 * Ordered pedal chain (Guitar → P1 → P2 → ... → Amp).
 *
 * Renders the adapted_pedals from a Stage 2 result, showing settings inline.
 * Master plan §10.3 — note that ToneAdapt only shows pedal NAMES; we show
 * per-pedal parameter values too (one of our differentiators).
 */
import { ArrowRight, Circle } from "lucide-react";

export interface PedalEntry {
  user_pedal_name: string;
  position_in_chain: number;
  settings: Array<{ knob: string; value: string }>;
  role: string;
  substitute_for: string | null;
}

interface Props {
  pedals: PedalEntry[];
  guitarLabel?: string | null;
  ampLabel?: string | null;
}

export function PedalChain({ pedals, guitarLabel, ampLabel }: Props) {
  const sorted = [...pedals].sort((a, b) => a.position_in_chain - b.position_in_chain);
  const isEmpty = sorted.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Signal chain
      </h3>
      {isEmpty ? (
        <p className="text-sm text-zinc-500">No pedals — go straight into the amp.</p>
      ) : (
        <ol className="flex flex-wrap items-stretch gap-2">
          <Bookend label={guitarLabel ?? "Your guitar"} />
          {sorted.map((p, i) => (
            <li key={`${p.position_in_chain}-${p.user_pedal_name}-${i}`} className="contents">
              <Arrow />
              <PedalCard p={p} />
            </li>
          ))}
          <Arrow />
          <Bookend label={ampLabel ?? "Your amp"} amp />
        </ol>
      )}
    </section>
  );
}

function PedalCard({ p }: { p: PedalEntry }) {
  return (
    <li className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 min-w-[140px] flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <Circle className="h-2 w-2 fill-current" aria-hidden />
        Position {p.position_in_chain}
      </div>
      <div className="text-sm font-semibold leading-tight">{p.user_pedal_name}</div>
      {p.substitute_for && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">
          ≈ {p.substitute_for}
        </div>
      )}
      {p.settings.length > 0 && (
        <dl className="text-[11px] text-zinc-600 dark:text-zinc-400 grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
          {p.settings.map((s) => (
            <div key={s.knob} className="contents">
              <dt className="font-medium uppercase tracking-wide">{s.knob}</dt>
              <dd className="text-right tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="text-[11px] text-zinc-500 leading-snug">{p.role}</div>
    </li>
  );
}

function Bookend({ label, amp }: { label: string; amp?: boolean }) {
  return (
    <li className="rounded-md bg-zinc-100 dark:bg-zinc-900 px-3 py-2 self-stretch flex items-center text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
      {amp ? "→ " : ""}
      {label}
    </li>
  );
}

function Arrow() {
  return (
    <li className="self-center text-zinc-400" aria-hidden>
      <ArrowRight className="h-4 w-4" />
    </li>
  );
}
