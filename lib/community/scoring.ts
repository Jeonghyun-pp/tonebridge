/**
 * Eval scoring — pure functions used by the nightly cron.
 *
 * Scale: 0 to 5.0
 *   knobs (gain/bass/mid/treble/presence):  ±2 → +0.5 each, max 2.5
 *   pedal categories present:               max 1.0
 *   playing tips present:                   max 0.5
 *   confidence within expected band:        max 0.5
 *   adaptation_notes meaningful (>50 chars): max 0.5
 *
 * Threshold: 3.5 (70%). 5/7 days under triggers pipeline halt.
 */

export interface ExpectedTone {
  song: string;
  artist: string;
  expected: {
    settings: { gain: number; bass: number; mid: number; treble: number; presence?: number };
    pedalCategories: string[];          // e.g. ["overdrive", "delay"]
    confidenceMin: number;              // floor (e.g. 0.5)
    confidenceMax?: number;             // optional ceiling
  };
}

export interface ActualTone {
  settings: { gain?: number | null; bass?: number | null; mid?: number | null; treble?: number | null; presence?: number | null };
  pedalCategories: string[];
  confidence: number;
  playingTips: string[];
  adaptationNotes?: string;
}

export interface ScoreBreakdown {
  knobs: number;
  pedals: number;
  tips: number;
  confidence: number;
  notes: number;
  total: number;
}

export const MAX_SCORE = 5.0;
export const THRESHOLD = 3.5;

export function scoreOne(expected: ExpectedTone["expected"], actual: ActualTone): ScoreBreakdown {
  // Knobs — 5 × 0.5 = 2.5
  const knobNames: Array<"gain" | "bass" | "mid" | "treble" | "presence"> = [
    "gain", "bass", "mid", "treble", "presence",
  ];
  let knobs = 0;
  for (const k of knobNames) {
    const expectedV = expected.settings[k];
    const actualV = actual.settings[k];
    if (expectedV === undefined || actualV === null || actualV === undefined) {
      // Knob not in expected (e.g. presence absent on some amps) — neutral, skip.
      continue;
    }
    const diff = Math.abs(actualV - expectedV);
    if (diff <= 2) knobs += 0.5;
  }

  // Pedals — every expected category must appear in actual
  let pedals = 0;
  if (expected.pedalCategories.length === 0) {
    pedals = 1; // no pedals expected → trivially matched
  } else {
    const actualSet = new Set(actual.pedalCategories.map((c) => c.toLowerCase()));
    const matched = expected.pedalCategories.filter((c) => actualSet.has(c.toLowerCase()));
    pedals = matched.length / expected.pedalCategories.length;
  }

  // Tips
  const tips = actual.playingTips.length > 0 ? 0.5 : 0;

  // Confidence band
  const confOk =
    actual.confidence >= expected.confidenceMin &&
    (expected.confidenceMax === undefined || actual.confidence <= expected.confidenceMax);
  const confidence = confOk ? 0.5 : 0;

  // Adaptation notes meaningful
  const notes = (actual.adaptationNotes ?? "").trim().length > 50 ? 0.5 : 0;

  const total = round2(knobs + pedals + tips + confidence + notes);
  return { knobs, pedals: round2(pedals), tips, confidence, notes, total };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Halt decision: 5+ of last 7 daily averages below threshold. */
export function shouldHalt(recentAverages: number[]): boolean {
  const window = recentAverages.slice(0, 7);
  const below = window.filter((s) => s < THRESHOLD).length;
  return below >= 5;
}
