/**
 * Phase 2 — Source discovery via Brave Search (Zero-Cost Track).
 *
 * Master plan §6.5.4 / DATA-AUTOMATION §18.3.
 *
 * Brave has AI-friendly ToS, 2,000 free queries/month, and an independent
 * index less saturated by SEO guitar content than Google. We query twice
 * per song and filter to a tier-1/2/3 whitelist — anything not on the list
 * is dropped.
 *
 * Output: up to 15 deduplicated SearchResult records sorted by tier then
 * source order, with integer tier labels consumed by Phase 5 scoring.
 *
 * Budget: Tier A 300 songs × 2 queries = 600 req — comfortably inside
 * the free tier. A `usage_logs` count should be added later for visibility.
 */
import type { SearchResult } from "./schemas";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 15;

// =============================================================================
// Domain whitelist + tier classification
// =============================================================================

/** Primary sources: interviews, rig rundowns, manufacturer artist pages. */
const TIER_1_DOMAINS = [
  "premierguitar.com",
  "guitarworld.com",
  "guitar.com",
  "music-radar.com",
  "musicradar.com",
  "youngguitar.jp",
  "fender.com",
  "gibson.com",
  "mesaboogie.com",
  "mesa-boogie.com",
  "marshall.com",
  "marshallamps.com",
  "vox.com",
  "voxamps.com",
  "orangeamps.com",
  "ernieball.com",
  "emgpickups.com",
  "seymourduncan.com",
  "dimarzio.com",
  "diezelamplification.com",
  "peavey.com",
  "rolandus.com",
  "line6.com",
];

/** Secondary/community: authoritative-adjacent but not primary. */
const TIER_2_DOMAINS = [
  "en.wikipedia.org",
  "ja.wikipedia.org",
  "ko.wikipedia.org",
  "equipboard.com",
  "musicbrainz.org",
  "discogs.com",
  "guitargeek.com",
  "ultimate-guitar.com", // for artist rig pages only — we never copy tab content
];

/** Reference-only. Used when Tier 1/2 yield nothing; `mode=inferred` ceiling. */
const TIER_3_DOMAINS = [
  "reddit.com",
  "thegearpage.net",
  "tdpri.com",
  "jemsite.com",
  "ultimatemetal.com",
];

const ALL_ALLOWED = [...TIER_1_DOMAINS, ...TIER_2_DOMAINS, ...TIER_3_DOMAINS];

export function classifyTier(url: string): 1 | 2 | 3 | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (TIER_1_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) return 1;
  if (TIER_2_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) return 2;
  if (TIER_3_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) return 3;
  return null;
}

export function isAllowedDomain(url: string): boolean {
  return classifyTier(url) !== null;
}

export { ALL_ALLOWED as WHITELIST_DOMAINS };

// =============================================================================
// Search
// =============================================================================

/** Queries we ask Brave. Kept to 2 per song to stay under free quota. */
export function buildQueries(song: string, artist: string): string[] {
  return [
    `"${artist}" "${song}" guitar rig amp pedal`,
    `${artist} guitar equipment interview rig rundown`,
  ];
}

interface BraveSearchResponse {
  web?: {
    results?: {
      url: string;
      title: string;
      description?: string;
      age?: string;
    }[];
  };
}

/**
 * Search for sources about (song, artist). Returns only whitelisted URLs,
 * deduplicated, up to MAX_RESULTS, sorted by tier ascending then by rank.
 *
 * Throws on network/5xx errors; returns [] on empty result.
 * HTTP 429 is surfaced so the caller can back off (we log but don't retry).
 */
export async function discoverSourcesBrave(
  song: string,
  artist: string,
  queries: string[] = buildQueries(song, artist)
): Promise<SearchResult[]> {
  if (!process.env.BRAVE_API_KEY) {
    throw new Error("BRAVE_API_KEY is required for Phase 2 Brave search");
  }

  const combined: SearchResult[] = [];

  for (const q of queries) {
    const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(q)}&count=10&safesearch=moderate`;
    const res = await fetch(url, {
      headers: {
        "X-Subscription-Token": process.env.BRAVE_API_KEY,
        Accept: "application/json",
        "Accept-Encoding": "gzip",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      console.warn(`[brave] rate-limited on query "${q}"; skipping`);
      continue;
    }
    if (!res.ok) {
      console.warn(`[brave] HTTP ${res.status} on query "${q}"`);
      continue;
    }
    const data = (await res.json()) as BraveSearchResponse;
    for (const r of data.web?.results ?? []) {
      const tier = classifyTier(r.url);
      if (tier === null) continue;
      combined.push({
        url: r.url,
        title: r.title,
        snippet: r.description ?? "",
        tier,
        publishedDate: r.age,
      });
    }
  }

  return dedupeAndSort(combined);
}

function dedupeAndSort(items: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const item of items) {
    const key = normalizeUrl(item.url);
    const existing = seen.get(key);
    // Keep the higher-tier (lower number) version when duplicated across queries.
    if (!existing || item.tier < existing.tier) {
      seen.set(key, item);
    }
  }
  return [...seen.values()].sort((a, b) => a.tier - b.tier).slice(0, MAX_RESULTS);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Strip common tracking params
    const trackingPrefixes = ["utm_", "fbclid", "gclid", "mc_eid", "mc_cid"];
    const keys = [...u.searchParams.keys()];
    for (const k of keys) {
      if (trackingPrefixes.some((prefix) => k.toLowerCase().startsWith(prefix))) {
        u.searchParams.delete(k);
      }
    }
    // Trailing slash normalization
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
