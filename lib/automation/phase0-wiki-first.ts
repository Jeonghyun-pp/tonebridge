/**
 * Phase 0 — Wikipedia-First extraction.
 *
 * Master plan §6.5.3 / §6.6 / DATA-AUTOMATION §18.2.
 *
 * For famous songs/artists, Wikipedia alone yields enough gear facts that we
 * can skip paid search (Phase 2) and paid fetches (Phase 3 /contents).
 * Wikipedia REST API is free, rate-limit generous, and ToS-safe (CC BY-SA
 * with URL attribution).
 *
 * Flow:
 *   1. Fetch song article via REST summary endpoint (fast, clean text)
 *   2. Fetch artist article HTML + extract Equipment-ish section
 *   3. LLM extracts guitar/amp/pedal facts with source_url attribution
 *   4. "sufficient" iff ≥3 concrete facts + ≥1 source URL
 *
 * Cost: 1 call to gemini-1.5-flash per song (~$0 on free tier).
 *
 * Save policy: we send the raw Wikipedia text to the LLM for extraction,
 * but only persist the URL + structured facts. Raw text never hits the DB.
 */
import { completeFromZod } from "@/lib/llm/provider";
import { WikiExtractionSchema, type WikiExtraction } from "./schemas";
import { stripHtml, extractSection } from "./fetch-guard";

const UA = "ToneBridgeBot/1.0 (contact@tonebridge.app)";
const WIKI_SECTIONS = ["Equipment", "Instruments", "Guitars", "Gear", "Rig"];

const SYSTEM_PROMPT = `You extract guitar gear facts from Wikipedia articles.

Hard rules:
1. Only extract facts EXPLICITLY STATED in the provided Wikipedia text.
2. Every gear item must cite a source_url of the Wikipedia article it came from.
3. Set sufficient=true ONLY if you have ≥3 concrete items (guitar model, amp model,
   or specific pedal) AND ≥1 source URL.
4. Set sufficient=false if Wikipedia only mentions "distorted guitar" generically
   without specific brand/model.
5. NEVER fabricate specific models that are not in the text. Set to null instead.
6. Pedal category = overdrive | distortion | fuzz | delay | reverb | chorus | phaser |
   flanger | wah | compressor | eq | boost | tremolo | vibrato | pitch | looper.`;

export interface Phase0Result {
  sufficient: boolean;
  extraction: WikiExtraction | null;
  tokenUsage: { in: number; out: number };
  reason?: "no_wiki_pages" | "llm_says_insufficient" | "fact_count_too_low";
}

/**
 * Run Phase 0 for a given (song, artist) pair.
 * Returns sufficient=false when Wikipedia alone can't produce a usable result —
 * caller should fall back to Phase 2 (search) in that case.
 */
export async function wikiFirstExtract(song: string, artist: string): Promise<Phase0Result> {
  const [songSource, artistSource] = await Promise.all([
    fetchSongSource(song, artist),
    fetchArtistEquipmentSource(artist),
  ]);

  if (!songSource && !artistSource) {
    return {
      sufficient: false,
      extraction: null,
      tokenUsage: { in: 0, out: 0 },
      reason: "no_wiki_pages",
    };
  }

  const userMessage = [
    `Song: ${song}`,
    `Artist: ${artist}`,
    "",
    songSource
      ? `[WIKI_SONG_URL] ${songSource.url}\n[WIKI_SONG_TEXT]\n${songSource.text.slice(0, 4000)}`
      : "",
    artistSource
      ? `\n[WIKI_ARTIST_URL] ${artistSource.url}\n[WIKI_ARTIST_SECTION_TEXT]\n${artistSource.text.slice(0, 3000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await completeFromZod({
    provider: "gemini",
    system: SYSTEM_PROMPT,
    user: userMessage,
    schema: WikiExtractionSchema,
    schemaName: "WikiExtraction",
    temperature: 0.1,
    withFallback: true,
  });

  // Independent sufficiency check — don't trust LLM's own `sufficient` blindly.
  const factCount = countConcreteFacts(result.data);
  const hasSource = result.data.sources.length >= 1;
  const actuallySufficient = result.data.sufficient && factCount >= 3 && hasSource;

  return {
    sufficient: actuallySufficient,
    extraction: result.data,
    tokenUsage: result.usage,
    reason: !result.data.sufficient
      ? "llm_says_insufficient"
      : !actuallySufficient
        ? "fact_count_too_low"
        : undefined,
  };
}

function countConcreteFacts(ext: WikiExtraction): number {
  let n = 0;
  if (ext.guitar?.model) n++;
  if (ext.amp?.model) n++;
  n += ext.pedals.filter((p) => Boolean(p.model)).length;
  return n;
}

// =============================================================================
// Wikipedia REST API helpers
// =============================================================================
const WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page";

interface WikiSource {
  url: string;
  text: string;
}

/**
 * Try several candidate titles for the song article, return the first whose
 * summary mentions the artist (disambiguation protection).
 *
 * We use the summary endpoint first (200-500 chars of lead text — enough for
 * most famous songs), then fall back to HTML if summary lacks gear keywords.
 */
async function fetchSongSource(song: string, artist: string): Promise<WikiSource | null> {
  const candidates = [
    `${song} (${artist} song)`,
    `${song} (song)`,
    song,
  ];
  for (const title of candidates) {
    const summary = await fetchSummary(title);
    if (!summary) continue;
    const lowerText = summary.extract.toLowerCase();
    if (!lowerText.includes(artist.toLowerCase())) continue;

    // If summary mentions gear keywords, use it as-is.
    if (mentionsGearKeyword(summary.extract)) {
      return { url: summary.url, text: summary.extract };
    }

    // Otherwise fetch full HTML for richer context.
    const html = await fetchHtml(title);
    if (html) {
      const text = stripHtml(html);
      if (text.toLowerCase().includes(artist.toLowerCase()) && text.length > 500) {
        return { url: summary.url, text };
      }
    }
    // Summary exists but no gear hint; return it anyway — LLM can decide.
    return { url: summary.url, text: summary.extract };
  }
  return null;
}

/**
 * Fetch artist article HTML and carve out an "Equipment"-ish section.
 * Returns null when no such section exists or the article is missing.
 */
async function fetchArtistEquipmentSource(artist: string): Promise<WikiSource | null> {
  const html = await fetchHtml(artist);
  if (!html) return null;
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(artist.replace(/ /g, "_"))}`;
  for (const sec of WIKI_SECTIONS) {
    const text = extractSection(html, sec);
    if (text && text.length > 200) {
      return { url: `${url}#${encodeURIComponent(sec)}`, text };
    }
  }
  return null;
}

async function fetchSummary(title: string): Promise<{ url: string; extract: string } | null> {
  try {
    const res = await fetch(`${WIKI_REST}/summary/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      type?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (json.type === "disambiguation" || !json.extract) return null;
    const url = json.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    return { url, extract: json.extract };
  } catch {
    return null;
  }
}

async function fetchHtml(title: string): Promise<string | null> {
  try {
    const res = await fetch(`${WIKI_REST}/html/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function mentionsGearKeyword(text: string): boolean {
  return /(\bguitar\b|\bamp(?:lifier)?\b|\bpedal\b|\bstratocaster\b|\btelecaster\b|\bles paul\b|\bsg\b|\bmarshall\b|\bfender\b|\bmesa\b|\bgibson\b|\bibanez\b)/i.test(
    text
  );
}
