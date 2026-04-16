/**
 * Zod schemas for the automation pipeline.
 *
 * Each schema is the LLM's structured output contract for a specific phase.
 * All are validated with `MySchema.parse()` after the LLM call so malformed
 * outputs are caught immediately.
 *
 * Master plan:
 *   §6.5.3   WikiExtractionSchema   — Phase 0 output
 *   §7.1     ResearchToneSchema     — /api/research-tone output
 *   §7.3     AdaptToneSchema        — /api/adapt-tone output
 *   §18.2    (wiki extract)
 *
 * Phase 3 and Phase 6 schemas live in this file too so S5 can import from one place.
 */
import { z } from "zod";

// =============================================================================
// Phase 0 — Wikipedia-First extraction
// =============================================================================
export const WikiExtractionSchema = z.object({
  guitar: z
    .object({
      brand: z.string().nullable(),
      model: z.string().nullable(),
      pickup_config: z.string().nullable(),
      source_url: z.string().nullable(),
    })
    .nullable(),
  amp: z
    .object({
      brand: z.string().nullable(),
      model: z.string().nullable(),
      source_url: z.string().nullable(),
    })
    .nullable(),
  pedals: z.array(
    z.object({
      brand: z.string().nullable(),
      model: z.string(),
      category: z.string(),
      source_url: z.string().nullable(),
    })
  ),
  tone_description: z.string().nullable(),
  sources: z.array(z.string()),
  sufficient: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type WikiExtraction = z.infer<typeof WikiExtractionSchema>;

// =============================================================================
// Phase 1 — Metadata enrichment (MusicBrainz + Wikipedia + Discogs)
// =============================================================================
export const MetadataSchema = z.object({
  mbid: z.string().nullable(),
  canonical_song: z.string(),
  canonical_artist: z.string(),
  album: z.string().nullable(),
  year: z.number().nullable(),
  genre_tags: z.array(z.string()),
  wiki_summary: z.string().nullable(),
  wiki_url: z.string().nullable(),
  artist_wiki_url: z.string().nullable(),
  discogs_credits: z.array(
    z.object({
      role: z.string(),
      name: z.string(),
    })
  ),
});
export type MetadataEnrichment = z.infer<typeof MetadataSchema>;

// =============================================================================
// Phase 3 — Multi-LLM extraction (S5 will use this)
// =============================================================================
export const ExtractionSchema = z.object({
  song: z.string(),
  artist: z.string(),

  guitar: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    pickup_config: z.string().nullable(),
    year: z.number().int().nullable(),
    source_indices: z.array(z.number().int()),
    confidence: z.number().min(0).max(1),
  }),

  amp: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    source_indices: z.array(z.number().int()),
    confidence: z.number().min(0).max(1),
  }),

  pedals: z.array(
    z.object({
      category: z.string(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      position_in_chain: z.number().int().nullable(),
      purpose: z.string().nullable(),
      source_indices: z.array(z.number().int()),
      confidence: z.number().min(0).max(1),
    })
  ),

  settings: z
    .object({
      gain: z.number().int().min(0).max(10).nullable(),
      bass: z.number().int().min(0).max(10).nullable(),
      mid: z.number().int().min(0).max(10).nullable(),
      treble: z.number().int().min(0).max(10).nullable(),
      presence: z.number().int().min(0).max(10).nullable(),
      reverb: z.number().int().min(0).max(10).nullable(),
      source_indices: z.array(z.number().int()),
      inferred: z.boolean(),
    })
    .nullable(),

  pickup_choice: z
    .object({
      value: z.string(),
      source_indices: z.array(z.number().int()),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),

  tone_characteristics: z.array(z.string()),

  extraction_notes: z.string(),
  overall_confidence: z.number().min(0).max(1),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// =============================================================================
// Phase 6 — Dual-Judge (S5 will use this)
// =============================================================================
export const JudgeSchema = z.object({
  field_verdicts: z.array(
    z.object({
      field: z.string(),                       // dot-path e.g. "guitar.model"
      verdict: z.enum(["PASS", "FAIL", "PARTIAL"]),
      reason: z.string(),
    })
  ),
  overall_pass: z.boolean(),
  suggested_mode: z.enum(["authoritative", "inferred", "speculative"]),
  suggested_confidence: z.number().min(0).max(1),
});
export type JudgeResult = z.infer<typeof JudgeSchema>;

// =============================================================================
// Search result (Phase 2 output)
// =============================================================================
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  tier: 1 | 2 | 3;
  publishedDate?: string;
}
