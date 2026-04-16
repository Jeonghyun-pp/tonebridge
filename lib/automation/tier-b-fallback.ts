/**
 * Tier B fallback — when Phase 2 finds no sources OR Phase 6 rejects.
 *
 * Master plan §6.6.11 + SEED-CATALOG §3 (Tier B generation).
 *
 * Produces a reference tone using ONLY LLM training knowledge, capped at
 * `mode='inferred'` with confidence ≤ 0.5 and an empty sources[] array.
 * This keeps the song in the catalog for UX continuity while making its
 * weaker provenance obvious through the ConfidenceBadge.
 *
 * One Gemini Flash call per song (~$0 on free tier).
 */
import { completeFromZod } from "@/lib/llm/provider";
import { z } from "zod";
import type { NewReferenceTone } from "@/lib/db/schema";

const TIER_B_SYSTEM = `You produce a reference tone profile using ONLY your training knowledge.

Hard rules:
1. If you are uncertain about specific gear, use generic category descriptions
   (e.g. "Tube Screamer-style overdrive") rather than fabricating specific models.
2. Set confidence ≤ 0.5 for every field.
3. mode MUST be "inferred" — do not claim authoritative.
4. sources[] MUST be empty — this is the Tier B fallback path with no cited sources.
5. For settings: pick reasonable 0-10 knob values that match the song's genre/era.
   Set settings.inferred=true to signal "these are derived, not quoted".`;

// Tight-but-flexible schema for Tier B. Kept deliberately simpler than the
// Phase 3 ExtractionSchema because there are no sources to cite.
const TierBSchema = z.object({
  song: z.string(),
  artist: z.string(),
  section: z
    .enum(["intro", "verse", "chorus", "riff", "solo", "bridge", "outro", "clean_intro"])
    .default("riff"),
  tone_type: z
    .enum(["clean", "crunch", "distorted", "high_gain", "ambient", "acoustic"])
    .nullable(),
  genre: z.string().nullable(),
  era: z.string().nullable(),

  guitar: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    pickup_config: z.string().nullable(),
  }),
  amp: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
  }),
  pedals: z.array(
    z.object({
      category: z.string(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      position_in_chain: z.number().int().nullable(),
      purpose: z.string().nullable(),
    })
  ),
  settings: z.object({
    gain: z.number().int().min(0).max(10),
    bass: z.number().int().min(0).max(10),
    mid: z.number().int().min(0).max(10),
    treble: z.number().int().min(0).max(10),
    presence: z.number().int().min(0).max(10).nullable(),
    reverb: z.number().int().min(0).max(10).nullable(),
    inferred: z.boolean(),
  }),
  guitar_knob_settings: z.object({
    volume: z.string(),
    tone: z.string(),
  }),
  pickup_choice: z.string().nullable(),
  tone_characteristics: z.array(z.string()),
  song_context: z.string(),
  confidence: z.number().min(0).max(0.5),
});

export type TierBGeneration = z.infer<typeof TierBSchema>;

export interface TierBResult {
  generation: TierBGeneration;
  token_usage: { in: number; out: number };
}

/**
 * Generate a Tier B reference tone. Throws on LLM failure —
 * the driver is expected to log and skip the song rather than retrying.
 */
export async function generateTierB(
  song: string,
  artist: string,
  section: TierBGeneration["section"] = "riff"
): Promise<TierBResult> {
  const res = await completeFromZod({
    provider: "gemini",
    system: TIER_B_SYSTEM,
    user: `Song: ${song}\nArtist: ${artist}\nSection: ${section}`,
    schema: TierBSchema,
    schemaName: "TierB",
    temperature: 0.3,
    withFallback: true,
  });
  return { generation: res.data, token_usage: res.usage };
}

/**
 * Shape the Tier B generation into a reference_tones insert row,
 * enforcing the Tier B invariants (empty sources, confidence ≤ 0.5, mode=inferred).
 */
export function tierBToReferenceTone(
  gen: TierBGeneration
): NewReferenceTone {
  return {
    song: gen.song,
    artist: gen.artist,
    section: gen.section,
    toneType: gen.tone_type ?? undefined,
    genre: gen.genre ?? undefined,
    era: gen.era ?? undefined,
    referenceGuitarFreetext: gen.guitar.model
      ? `${gen.guitar.brand ?? ""} ${gen.guitar.model}`.trim()
      : null,
    referenceAmpFreetext: gen.amp.model
      ? `${gen.amp.brand ?? ""} ${gen.amp.model}`.trim()
      : null,
    referencePedals: gen.pedals.map((p, i) => ({
      brand: p.brand ?? undefined,
      model: p.model ?? null,
      category: p.category,
      position_in_chain: p.position_in_chain ?? i + 1,
      purpose: p.purpose ?? null,
      confidence: Math.min(0.5, gen.confidence),
      sources: [],
    })),
    referenceSettings: gen.settings,
    guitarKnobSettings: gen.guitar_knob_settings,
    pickupChoice: gen.pickup_choice ?? undefined,
    toneCharacteristics: gen.tone_characteristics,
    songContext: gen.song_context,
    sources: [],
    confidence: Math.min(0.5, gen.confidence).toFixed(2),
    mode: "inferred",
  };
}
