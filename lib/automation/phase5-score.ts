/**
 * Phase 5 — Confidence scoring.
 *
 * Master plan §6.6.3 + DATA-AUTOMATION §6.
 *
 * Combines two signals:
 *   1. Source tier composition — more Tier-1 sources → higher ceiling
 *   2. LLM's own field confidences — weighted average across fields
 *
 * The decision rule for `mode` is deterministic based on tier counts,
 * regardless of LLM self-reported confidence. This prevents over-confident
 * LLMs from earning `authoritative` without corroborating primary sources.
 */
import type { Extraction, SearchResult } from "./schemas";

export type Mode = "authoritative" | "inferred" | "speculative";

export interface Score {
  mode: Mode;
  confidence: number;     // [0, 1] rounded to 2 decimals
  field_scores: {
    guitar: number;
    amp: number;
    pedals: number;
    settings: number;
  };
  tier_counts: { t1: number; t2: number; t3: number };
}

export function scoreTone(extraction: Extraction, sources: SearchResult[]): Score {
  const tierCounts = countTiers(sources);

  const fields = {
    guitar: extraction.guitar.confidence,
    amp: extraction.amp.confidence,
    pedals:
      extraction.pedals.length > 0
        ? extraction.pedals.reduce((a, p) => a + p.confidence, 0) / extraction.pedals.length
        : 0.5,
    // Inferred settings are weaker than quoted settings, but still > no settings at all
    settings:
      extraction.settings === null
        ? 0.3
        : extraction.settings.inferred
          ? 0.4
          : 0.8,
  };
  const fieldAvg = (fields.guitar + fields.amp + fields.pedals + fields.settings) / 4;

  const mode = decideMode(tierCounts);
  const baseline = modeBaseline(mode);
  const confidence = roundTo(2, Math.max(baseline, Math.min(fieldAvg, modeCeiling(mode))));

  return { mode, confidence, field_scores: fields, tier_counts: tierCounts };
}

// =============================================================================
// Helpers (exported for unit tests)
// =============================================================================

export function countTiers(sources: SearchResult[]): { t1: number; t2: number; t3: number } {
  let t1 = 0;
  let t2 = 0;
  let t3 = 0;
  for (const s of sources) {
    if (s.tier === 1) t1++;
    else if (s.tier === 2) t2++;
    else t3++;
  }
  return { t1, t2, t3 };
}

/**
 * Tier count → mode. Thresholds mirror DATA-AUTOMATION §6.
 *
 *   authoritative  ≥2 T1, OR (≥1 T1 AND ≥1 T2)
 *   inferred       ≥1 T2
 *   speculative    only T3 or nothing
 */
export function decideMode(counts: { t1: number; t2: number; t3: number }): Mode {
  if (counts.t1 >= 2) return "authoritative";
  if (counts.t1 >= 1 && counts.t2 >= 1) return "authoritative";
  if (counts.t2 >= 1) return "inferred";
  return "speculative";
}

/** The minimum confidence we're willing to publish at for a given mode. */
export function modeBaseline(mode: Mode): number {
  return mode === "authoritative" ? 0.7 : mode === "inferred" ? 0.45 : 0.25;
}

/** The maximum confidence — caps LLM over-confidence against insufficient sources. */
export function modeCeiling(mode: Mode): number {
  return mode === "authoritative" ? 0.95 : mode === "inferred" ? 0.7 : 0.4;
}

function roundTo(decimals: number, n: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
