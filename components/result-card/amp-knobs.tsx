/**
 * Visual rotary knobs (0-10) for amp settings.
 *
 * Pure CSS — no charting library, no SVG dependencies. Each knob is a
 * disc with a pointer line rotated based on the value (-135° to +135°,
 * the conventional pot sweep range).
 *
 * If knob_layout from the gear DB indicates a knob is absent (e.g. an amp
 * with no presence control), we render that slot as `—` so users see WHY
 * it's blank rather than wondering if the recommendation is incomplete.
 */
import type { KnobLayout } from "@/lib/db/schema";

export interface AmpKnobValues {
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence?: number | null;
  reverb?: number | null;
}

interface Props {
  values: AmpKnobValues;
  layout?: KnobLayout | null;
  ampLabel?: string | null;
}

const KNOB_ORDER: Array<keyof AmpKnobValues> = [
  "gain",
  "bass",
  "mid",
  "treble",
  "presence",
  "reverb",
];

export function AmpKnobs({ values, layout, ampLabel }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Amp settings
        </h3>
        {ampLabel && <span className="text-xs text-zinc-500">{ampLabel}</span>}
      </header>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {KNOB_ORDER.map((label) => {
          const value = values[label];
          const present = layout ? layout[label as keyof KnobLayout] !== false : true;
          if (!present || value === null || value === undefined) {
            return <KnobSlot key={label} label={label} absent />;
          }
          return <KnobSlot key={label} label={label} value={value} />;
        })}
      </div>
    </section>
  );
}

interface SlotProps {
  label: string;
  value?: number;
  absent?: boolean;
}

function KnobSlot({ label, value, absent }: SlotProps) {
  const angle = absent ? 0 : -135 + ((value ?? 0) / 10) * 270;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative h-16 w-16 rounded-full border-2 ${
          absent
            ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
            : "border-zinc-700 dark:border-zinc-300 bg-zinc-900 dark:bg-zinc-100"
        }`}
        aria-label={absent ? `${label}: absent` : `${label}: ${value} of 10`}
      >
        {/* tick marks */}
        <span className="absolute inset-0 flex items-end justify-center pb-1 text-[8px] text-zinc-500">
          {absent ? "—" : ""}
        </span>
        {!absent && (
          <span
            className="absolute left-1/2 top-1/2 block h-7 w-0.5 origin-bottom -translate-x-1/2 -translate-y-full rounded-full bg-amber-400"
            style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }}
            aria-hidden
          />
        )}
      </div>
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className={`text-base font-semibold ${absent ? "text-zinc-400" : ""}`}>
        {absent ? "—" : value}
      </span>
    </div>
  );
}
