/**
 * Schemas for the LIVE user-facing endpoints (/api/research-tone, /api/adapt-tone).
 *
 * Distinct from lib/automation/schemas.ts which is for the OFFLINE batch
 * extraction pipeline (multi-LLM consensus over real sources). These live
 * schemas are the contract for single-LLM-call responses driven by user input.
 *
 * Master plan §7.1.
 *
 * Pedal settings use an array-of-pairs shape rather than `z.record()` because
 * Gemini's responseSchema doesn't support additionalProperties. Array of pairs
 * survives the schema-compat conversion intact.
 */
import { z } from "zod";

// =============================================================================
// Stage 1 — Research Tone
// =============================================================================
const SettingsSchema = z.object({
  gain: z.number().int().min(0).max(10),
  bass: z.number().int().min(0).max(10),
  mid: z.number().int().min(0).max(10),
  treble: z.number().int().min(0).max(10),
  presence: z.number().int().min(0).max(10).nullable(),
  reverb: z.number().int().min(0).max(10).nullable(),
});

const KnobPairSchema = z.object({
  knob: z.string(),    // "drive" "tone" "level" "mix" "feedback" "rate" "depth" "time"
  value: z.string(),   // "6" "5-7" "max" etc
});

const PedalEntrySchema = z.object({
  name: z.string(),                       // "Ibanez TS9 Tube Screamer"
  brand: z.string(),
  model: z.string().nullable(),
  category: z.string(),                   // overdrive | distortion | delay | reverb | wah | ...
  position_in_chain: z.number().int(),    // 1-based; before-amp first
  purpose: z.string(),                    // "tighten low end before high gain"
  timing: z.string().nullable(),          // "always on" | "during solos" | "intro only"
  settings: z.array(KnobPairSchema).nullable(),
  confidence: z.number().min(0).max(1),
});

export const ResearchToneSchema = z.object({
  song: z.string(),
  artist: z.string(),
  section: z.enum(["intro", "verse", "chorus", "riff", "solo", "bridge", "outro", "clean_intro"]),
  tone_type: z.enum(["clean", "crunch", "distorted", "high_gain", "ambient", "acoustic"]),
  instrument: z.enum(["guitar", "bass"]).default("guitar"),
  genre: z.string(),
  era: z.string(),                                       // "1970s" "2010s"

  guitar: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    pickup_config: z.string().nullable(),                // "SSS" "HH" "HSS" etc
  }),
  amp: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
  }),
  pickup_choice: z.string().nullable(),                  // "Bridge" "Neck" "Middle" "Bridge+Middle"

  settings: SettingsSchema,
  guitar_knob_settings: z.object({
    volume: z.string(),                                  // "8-10"
    tone: z.string(),                                    // "7-8"
  }),

  pedals: z.array(PedalEntrySchema),
  tone_characteristics: z.array(z.string()),             // ["crunchy","mid_heavy","percussive"]
  song_context: z.string(),                              // "raunchy mid-heavy crunch for the main riff"

  mode: z.enum(["authoritative", "inferred", "speculative"]),
  overall_confidence: z.number().min(0).max(1),
});
export type ResearchTone = z.infer<typeof ResearchToneSchema>;

// =============================================================================
// Stage 2 — Adapt Tone (translate to user's rig)
// =============================================================================
const AdaptedPedalSchema = z.object({
  user_pedal_name: z.string(),                           // "Boss SD-1" — must be one user owns
  position_in_chain: z.number().int(),
  settings: z.array(KnobPairSchema),
  role: z.string(),                                      // "Main drive (substituting Tube Screamer)"
  substitute_for: z.string().nullable(),                 // original pedal name being replaced
});

const MissingPedalSchema = z.object({
  original_pedal: z.string(),
  category: z.string(),
  recommendation: z.string(),                            // "Any mid-hump OD: TS-style or SD-1 style"
});

export const AdaptToneSchema = z.object({
  adapted_settings: SettingsSchema,
  adapted_guitar_knobs: z.object({
    volume: z.string(),
    tone: z.string(),
  }),
  adapted_pickup_choice: z.string(),
  adapted_pedals: z.array(AdaptedPedalSchema),
  missing_pedals: z.array(MissingPedalSchema),
  playing_tips: z.array(z.string()),
  adaptation_notes: z.string(),                          // explain why values shifted from original
  confidence: z.number().min(0).max(1),
});
export type AdaptTone = z.infer<typeof AdaptToneSchema>;
