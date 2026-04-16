/**
 * Phase 3 — Multi-LLM consensus extraction.
 *
 * Master plan §6.6.7 / DATA-AUTOMATION §19.4.
 *
 * Run three extractions in parallel with different providers/seeds, then
 * keep only fields where ≥2 runs agree. Disagreements collapse to null
 * so Phase 6 judges don't get a chance to bless LLM-specific hallucinations.
 *
 * Yield trade-off: we lose ~10-20% of field-level info vs single-LLM
 * extraction, but we gain structural environmental robustness —
 * different providers with different training corpora rarely invent
 * the same fabricated pedal model.
 */
import { completeFromZod } from "@/lib/llm/provider";
import { ExtractionSchema, type Extraction, type SearchResult } from "./schemas";

// =============================================================================
// Prompt
// =============================================================================
const EXTRACTION_SYSTEM = `You are a music gear documentation extractor. Given source materials
about a song and artist, produce a structured JSON extraction.

HARD RULES:
1. Every factual claim MUST cite source_indices — 0-based indices into the Sources list.
2. If no source mentions a field, set it to null. NEVER invent a model or brand.
3. If sources disagree, prefer the higher-tier source (Tier 1 > 2 > 3) and note the conflict
   in extraction_notes.
4. settings numeric values: extract only when sources give explicit knob positions or clear
   qualitative descriptions that map to values (e.g. "heavy scooped mid" → mid ≤ 4).
   Set inferred=true whenever you're mapping from qualitative language.
5. confidence per field: 0.8+ if a Tier 1 source supports it, 0.5-0.7 mixed Tier 1/2,
   0.3-0.5 Tier 2 only, 0.2-0.3 Tier 3 or single ambiguous mention.
6. overall_confidence:
   ≥0.85 when ≥2 Tier-1 sources agree
   ~0.7 mix of Tier 1 + Tier 2
   ~0.5 Tier 2 only
   ≤0.4 Tier 3 only
7. Do NOT copy source text verbatim. Extract facts only; the extraction_notes field is for
   short operator context, not quotations.`;

// =============================================================================
// Public API
// =============================================================================
export interface ConsensusInput {
  song: string;
  artist: string;
  sources: Array<{ url: string; title: string; text: string; tier: 1 | 2 | 3 }>;
}

export interface ConsensusResult {
  extraction: Extraction;
  consensus_score: number;          // [0, 1]  — fraction of scalar fields with ≥2/3 agreement
  token_usage: { in: number; out: number };
  providers_used: string[];
  runs_survived: number;            // 2 or 3; degrades if a provider errors out
}

/**
 * Run 3 parallel extractions and merge by 2/3 majority.
 * Degrades gracefully: if a provider errors, we merge what remains (min 2 runs).
 * Throws when fewer than 2 runs succeed — the caller should send that song
 * to Tier B fallback.
 */
export async function extractWithConsensus(input: ConsensusInput): Promise<ConsensusResult> {
  const userMsg = buildUserMessage(input);
  const shared = {
    system: EXTRACTION_SYSTEM,
    user: userMsg,
    schema: ExtractionSchema,
    schemaName: "Extraction",
    withFallback: false as const,    // we want clean run_i failure visibility
  };

  type Run = Awaited<ReturnType<typeof completeFromZod<typeof ExtractionSchema>>>;
  const attempts: PromiseSettledResult<Run>[] = await Promise.allSettled([
    completeFromZod({ ...shared, provider: "gemini", seed: 1, temperature: 0.15 }),
    completeFromZod({ ...shared, provider: "gemini", seed: 2, temperature: 0.35 }),
    completeFromZod({ ...shared, provider: "groq", seed: 42, temperature: 0.2 }),
  ]);

  const successes: Run[] = attempts
    .filter((a): a is PromiseFulfilledResult<Run> => a.status === "fulfilled")
    .map((a) => a.value);

  if (successes.length < 2) {
    const errors = attempts
      .filter((a): a is PromiseRejectedResult => a.status === "rejected")
      .map((a) => (a.reason instanceof Error ? a.reason.message : String(a.reason)))
      .join(" | ");
    throw new Error(`extractWithConsensus: only ${successes.length}/3 runs succeeded (${errors})`);
  }

  const runs: Extraction[] = successes.map((s) => s.data);
  const merged = mergeByMajority(runs, input);
  const tokenUsage = successes.reduce(
    (acc, s) => ({ in: acc.in + s.usage.in, out: acc.out + s.usage.out }),
    { in: 0, out: 0 }
  );

  return {
    extraction: merged.extraction,
    consensus_score: merged.consensus_score,
    token_usage: tokenUsage,
    providers_used: successes.map((s) => s.provider),
    runs_survived: successes.length,
  };
}

function buildUserMessage(input: ConsensusInput): string {
  const lines = [
    `Song: ${input.song}`,
    `Artist: ${input.artist}`,
    ``,
    `Sources:`,
    ...input.sources.map(
      (s, i) =>
        `[${i}] (tier ${s.tier}) ${s.url}\nTITLE: ${s.title}\nTEXT:\n${s.text.slice(0, 4000)}`
    ),
  ];
  return lines.join("\n");
}

// =============================================================================
// Merge — exported for unit testing
// =============================================================================
export interface MergeResult {
  extraction: Extraction;
  consensus_score: number;
}

export function mergeByMajority(
  runs: Extraction[],
  input: { song: string; artist: string }
): MergeResult {
  if (runs.length === 0) {
    throw new Error("mergeByMajority: no runs provided");
  }
  const n = runs.length;
  let agreed = 0;
  let checked = 0;

  // --- Guitar object ---
  const guitarBrand = majorityOrNull(runs.map((r) => r.guitar.brand), n);
  const guitarModel = majorityOrNull(runs.map((r) => r.guitar.model), n);
  const guitarPickupConfig = majorityOrNull(runs.map((r) => r.guitar.pickup_config), n);
  const guitarYear = majorityOrNull(runs.map((r) => r.guitar.year), n);
  for (const m of [guitarBrand, guitarModel, guitarPickupConfig, guitarYear]) {
    checked++;
    agreed += m.agreementFraction;
  }
  const guitar = {
    brand: guitarBrand.value,
    model: guitarModel.value,
    pickup_config: guitarPickupConfig.value,
    year: guitarYear.value,
    source_indices: unionSourceIndices(runs.map((r) => r.guitar.source_indices)),
    confidence: Math.min(...runs.map((r) => r.guitar.confidence)) * avgAgreement([guitarBrand, guitarModel]),
  };

  // --- Amp object ---
  const ampBrand = majorityOrNull(runs.map((r) => r.amp.brand), n);
  const ampModel = majorityOrNull(runs.map((r) => r.amp.model), n);
  for (const m of [ampBrand, ampModel]) {
    checked++;
    agreed += m.agreementFraction;
  }
  const amp = {
    brand: ampBrand.value,
    model: ampModel.value,
    source_indices: unionSourceIndices(runs.map((r) => r.amp.source_indices)),
    confidence: Math.min(...runs.map((r) => r.amp.confidence)) * avgAgreement([ampBrand, ampModel]),
  };

  // --- Pedals: intersection by (brand|model|category) ---
  const pedalKeyCount = new Map<string, number>();
  const pedalKeyData = new Map<string, Extraction["pedals"][number]>();
  for (const run of runs) {
    for (const p of run.pedals) {
      const key = `${p.brand ?? ""}|${p.model ?? ""}|${p.category}`;
      pedalKeyCount.set(key, (pedalKeyCount.get(key) ?? 0) + 1);
      if (!pedalKeyData.has(key)) pedalKeyData.set(key, p);
    }
  }
  const pedalThreshold = Math.min(2, n);
  const pedals: Extraction["pedals"] = [];
  for (const [key, count] of pedalKeyCount.entries()) {
    if (count < pedalThreshold) continue;
    const data = pedalKeyData.get(key);
    if (data) pedals.push(data);
  }

  // --- Settings: average numeric if within ±2, null otherwise ---
  const hasSettings = runs.some((r) => r.settings !== null);
  let settings: Extraction["settings"] | null = null;
  if (hasSettings) {
    const ss = runs.map((r) => r.settings).filter((s): s is NonNullable<Extraction["settings"]> => s !== null);
    if (ss.length >= 2) {
      settings = {
        gain: avgIntOrNull(ss.map((s) => s.gain)),
        bass: avgIntOrNull(ss.map((s) => s.bass)),
        mid: avgIntOrNull(ss.map((s) => s.mid)),
        treble: avgIntOrNull(ss.map((s) => s.treble)),
        presence: avgIntOrNull(ss.map((s) => s.presence)),
        reverb: avgIntOrNull(ss.map((s) => s.reverb)),
        source_indices: unionSourceIndices(ss.map((s) => s.source_indices)),
        inferred: ss.some((s) => s.inferred),
      };
    }
  }

  // --- Pickup choice ---
  const pickupValues = runs
    .map((r) => r.pickup_choice?.value)
    .filter((v): v is string => Boolean(v));
  const pickupMajority = majorityOrNull(pickupValues.length ? runs.map((r) => r.pickup_choice?.value ?? null) : [null], n);
  const pickup_choice: Extraction["pickup_choice"] =
    pickupMajority.value !== null
      ? {
          value: pickupMajority.value,
          source_indices: unionSourceIndices(
            runs.map((r) => r.pickup_choice?.source_indices ?? [])
          ),
          confidence:
            Math.min(...runs.filter((r) => r.pickup_choice).map((r) => r.pickup_choice!.confidence)) *
            pickupMajority.agreementFraction,
        }
      : null;

  // --- tone_characteristics: union across runs ---
  const tagSet = new Set<string>();
  for (const r of runs) for (const t of r.tone_characteristics ?? []) tagSet.add(t);

  // --- extraction_notes: take the longest (most informative), cap to 500 chars ---
  const notes = runs
    .map((r) => r.extraction_notes ?? "")
    .sort((a, b) => b.length - a.length)[0]
    .slice(0, 500);

  const overallRaw = Math.min(...runs.map((r) => r.overall_confidence));
  const consensus_score = checked > 0 ? agreed / checked : 0;
  const overall_confidence = Math.max(0, Math.min(1, overallRaw * consensus_score));

  const extraction: Extraction = {
    song: input.song,
    artist: input.artist,
    guitar,
    amp,
    pedals,
    settings,
    pickup_choice,
    tone_characteristics: [...tagSet],
    extraction_notes: notes,
    overall_confidence,
  };

  // Runtime safety: zod-validate the merged object so we catch bugs now, not downstream.
  return { extraction: ExtractionSchema.parse(extraction), consensus_score };
}

// =============================================================================
// Merge primitives — exported for tests
// =============================================================================

interface MajorityVote<T> {
  value: T | null;
  agreementFraction: number; // 0..1, based on top-count / n
}

/**
 * Pick the most-agreed-upon value. If the top count is below ceil(n/2)+… well,
 * more precisely: we require ≥2 out of n (or the full n when n=1). null wins
 * for tie-with-null situations.
 */
export function majorityOrNull<T>(values: (T | null)[], n: number): MajorityVote<T> {
  const counts = new Map<string, { value: T | null; count: number }>();
  for (const v of values) {
    const k = JSON.stringify(v);
    const existing = counts.get(k);
    if (existing) existing.count++;
    else counts.set(k, { value: v, count: 1 });
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  if (!top) return { value: null, agreementFraction: 0 };
  const threshold = n >= 3 ? 2 : n; // n=3→need 2, n=2→need 2, n=1→need 1
  if (top.count >= threshold && top.value !== null) {
    return { value: top.value, agreementFraction: top.count / n };
  }
  return { value: null, agreementFraction: 0 };
}

export function unionSourceIndices(arrays: number[][]): number[] {
  const seen = new Set<number>();
  for (const arr of arrays) for (const n of arr) seen.add(n);
  return [...seen].sort((a, b) => a - b);
}

/** Average a list of ints; null if <2 non-null values or spread >2. */
export function avgIntOrNull(values: (number | null)[], maxSpread = 2): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max - min > maxSpread) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function avgAgreement<T>(votes: MajorityVote<T>[]): number {
  if (votes.length === 0) return 1;
  return votes.reduce((a, v) => a + v.agreementFraction, 0) / votes.length;
}
