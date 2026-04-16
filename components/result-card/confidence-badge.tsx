/**
 * Confidence badge — the differentiator vs ToneAdapt (master plan §10.4).
 *
 * Three states map to reference_tones.mode + the live API's confidence level.
 * Always render this on every result card; never let users assume `inferred`
 * results are equivalent to `authoritative` ones.
 */
import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";

export type Mode = "authoritative" | "inferred" | "speculative";

interface Props {
  mode: Mode;
  confidence?: number | null;
  source?: "tier_a" | "lazy_cache" | "live" | null;
}

export function ConfidenceBadge({ mode, confidence, source }: Props) {
  const pct = typeof confidence === "number" ? Math.round(confidence * 100) : null;

  if (mode === "authoritative") {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-950/50 px-2.5 py-1 text-xs font-medium text-green-800 dark:text-green-300"
        title="Backed by Tier-1 sources (interviews, rig rundowns, manufacturer pages)"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Verified
        {pct !== null && <span className="opacity-70">· {pct}%</span>}
      </div>
    );
  }

  if (mode === "inferred") {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 dark:bg-yellow-950/50 px-2.5 py-1 text-xs font-medium text-yellow-900 dark:text-yellow-300"
        title="Reasonable starting point — no primary sources cited"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Inferred
        {pct !== null && <span className="opacity-70">· {pct}%</span>}
        {source === "live" && <span className="opacity-60">· live</span>}
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-800 dark:text-red-300"
      title="Low confidence — please tune by ear"
    >
      <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
      Speculative
      {pct !== null && <span className="opacity-70">· {pct}%</span>}
    </div>
  );
}
