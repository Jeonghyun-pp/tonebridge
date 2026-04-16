/**
 * Live Stage 1 — Research Tone (single LLM call, training knowledge only).
 *
 * Master plan §7.2.
 *
 * Used by:
 *   /api/research-tone  — when Tier A/B/cache miss
 *   Tier B batch        — for the 1,200 pre-cached songs
 *
 * The OFFLINE pipeline (lib/automation/phase3-multi-llm) is for sourced
 * extractions yielding `mode='authoritative'`. THIS function has NO sources,
 * so we hard-cap mode at 'inferred' regardless of the LLM's self-report —
 * "the LLM is confident" is not the same as "verified by primary sources".
 */
import { completeFromZod, estimateCostUsd } from "./provider";
import { ResearchToneSchema, type ResearchTone } from "./api-schemas";

const SYSTEM_PROMPT = `You are a guitar tone documentation expert. Given a song and artist,
produce a reference tone profile from your training knowledge of:
- artist interviews, rig rundown videos, manufacturer artist pages, liner notes
- general genre/era conventions when specific gear is undocumented

Hard rules:
1. Knob values are integers 0-10. guitar_knob_settings.volume / .tone are STRING RANGES like "8-10".
2. NEVER fabricate specific pedal models you are unsure about. Use category-level
   descriptions (e.g. "Tube Screamer-style overdrive") rather than inventing a model.
3. Each pedal has its own confidence (0.0-1.0). Be conservative on guesses.
4. overall_confidence reflects total certainty. Famous well-documented songs ≥ 0.7.
   Obscure songs ≤ 0.4 with mode="inferred" or "speculative".
5. mode SHOULD usually be "inferred" — you have no cited sources here.
   Use "speculative" when you have low confidence in basic gear identity.
6. Match confidence to documentation reality, not to user satisfaction.`;

export interface ResearchToneInput {
  song: string;
  artist: string;
  section?: ResearchTone["section"];
  toneType?: ResearchTone["tone_type"] | null;
  instrument?: ResearchTone["instrument"];
}

export interface ResearchToneOutput {
  data: ResearchTone;
  usage: { in: number; out: number };
  costUsd: number;
  model: string;
  provider: string;
}

export async function researchTone(input: ResearchToneInput): Promise<ResearchToneOutput> {
  const userMsg = [
    `Song: ${input.song}`,
    `Artist: ${input.artist}`,
    `Section: ${input.section ?? "riff"}`,
    input.toneType ? `Target tone type: ${input.toneType}` : null,
    `Instrument: ${input.instrument ?? "guitar"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await completeFromZod({
    provider: "gemini",
    system: SYSTEM_PROMPT,
    user: userMsg,
    schema: ResearchToneSchema,
    schemaName: "ResearchTone",
    temperature: 0.3,
    withFallback: true,
  });

  // Defense-in-depth: live-API path has no sources, so 'authoritative' is never honest.
  // Downgrade to 'inferred' if the LLM over-claims.
  const data: ResearchTone = {
    ...res.data,
    mode: res.data.mode === "authoritative" ? "inferred" : res.data.mode,
    overall_confidence: Math.min(res.data.overall_confidence, 0.7),
  };

  return {
    data,
    usage: res.usage,
    costUsd: estimateCostUsd(res.model, res.usage),
    model: res.model,
    provider: res.provider,
  };
}
