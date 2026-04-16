/**
 * URL slug helpers for the /community/[slug] SEO surface.
 *
 * Slug format: `{song}--{artist}--{section}--{toneType}--{instrument}`
 *
 * Each segment is lowercased, accents normalized, then non-alphanumeric
 * (except hyphen) replaced with hyphens. Korean / Japanese chars survive
 * as URL-encoded — Google handles them fine and we don't want to lose
 * the artist names entirely via romanization heuristics.
 */
import type { ReferenceTone } from "@/lib/db/schema";

const SEPARATOR = "--";

export function toSlug(row: Pick<
  ReferenceTone,
  "song" | "artist" | "section" | "toneType" | "instrument"
>): string {
  return [
    slugifyPart(row.song),
    slugifyPart(row.artist),
    slugifyPart(row.section),
    slugifyPart(row.toneType ?? "any"),
    slugifyPart(row.instrument ?? "guitar"),
  ].join(SEPARATOR);
}

export interface ParsedSlug {
  song: string;
  artist: string;
  section: ReferenceTone["section"];
  toneType: ReferenceTone["toneType"] | null;
  instrument: string;
}

const VALID_SECTIONS = new Set([
  "intro", "verse", "chorus", "riff", "solo", "bridge", "outro", "clean_intro",
] as const);
const VALID_TONE_TYPES = new Set([
  "clean", "crunch", "distorted", "high_gain", "ambient", "acoustic",
] as const);

export function parseSlug(slug: string): ParsedSlug | null {
  const parts = decodeURIComponent(slug).split(SEPARATOR);
  if (parts.length !== 5) return null;
  const [song, artist, section, toneType, instrument] = parts;
  if (!song || !artist) return null;
  if (!VALID_SECTIONS.has(section as never)) return null;

  return {
    song: deslugify(song),
    artist: deslugify(artist),
    section: section as ReferenceTone["section"],
    toneType: toneType === "any" || !VALID_TONE_TYPES.has(toneType as never)
      ? null
      : (toneType as ReferenceTone["toneType"]),
    instrument: instrument || "guitar",
  };
}

function slugifyPart(s: string): string {
  return s
    .normalize("NFKD")                              // decompose accents (also splits Hangul into jamo)
    .replace(/[\u0300-\u036f]/g, "")                // strip Latin combining marks
    .normalize("NFC")                               // re-compose Hangul jamo back to syllables
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")                // smart + dumb apostrophes drop
    // Keep ASCII alphanumeric + underscore (for enum values like "high_gain"),
    // Hangul syllables (U+AC00-D7AF), Hiragana + Katakana (U+3040-30FF),
    // and CJK unified ideographs (U+4E00-9FFF). Everything else -> hyphen.
    .replace(/[^a-z0-9_\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Best-effort de-slugify for display. We can't recover the exact original
 * case/punctuation, but for SEO + display this approximation is fine.
 * The DB lookup uses case-insensitive matching on song/artist anyway.
 */
function deslugify(s: string): string {
  return s
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
