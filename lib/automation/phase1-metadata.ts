/**
 * Phase 1 — Metadata enrichment.
 *
 * DATA-AUTOMATION §2.1-2.2 — all sources here are official, free, and
 * commercial-use-safe (CC0 / CC BY-SA).
 *
 * Sources:
 *   MusicBrainz   — canonical song/artist names, mbid, album, year, genre tags
 *   Wikipedia     — summary lead text (used to disambiguate and provide context)
 *   Discogs       — producer/engineer credits (paired with DISCOGS_KEY)
 *
 * Output: normalized `MetadataEnrichment` record. Raw text is NOT stored —
 * only structured fields + source URLs.
 */
import { MetadataSchema, type MetadataEnrichment } from "./schemas";

const UA = "ToneBridgeBot/1.0 (contact@tonebridge.app)";

export async function enrichMetadata(song: string, artist: string): Promise<MetadataEnrichment> {
  const [mb, songWiki, artistWiki, discogs] = await Promise.all([
    fetchMusicBrainz(song, artist),
    fetchWikipediaSummary(`${song} (${artist} song)`).then(
      (r) => r ?? fetchWikipediaSummary(`${song} (song)`)
    ),
    fetchWikipediaSummary(artist),
    fetchDiscogsCredits(song, artist),
  ]);

  const canonicalSong = mb?.title ?? song;
  const canonicalArtist = mb?.["artist-credit"]?.[0]?.name ?? artist;

  return MetadataSchema.parse({
    mbid: mb?.id ?? null,
    canonical_song: canonicalSong,
    canonical_artist: canonicalArtist,
    album: mb?.releases?.[0]?.title ?? null,
    year: parseYear(mb?.releases?.[0]?.date),
    genre_tags: mb?.tags?.map((t) => t.name).filter(Boolean) ?? [],
    wiki_summary: songWiki?.extract ?? null,
    wiki_url: songWiki?.url ?? null,
    artist_wiki_url: artistWiki?.url ?? null,
    discogs_credits: discogs ?? [],
  });
}

// =============================================================================
// MusicBrainz (CC0, rate limit 1 req/s)
// =============================================================================
interface MBRecording {
  id: string;
  title: string;
  "artist-credit"?: { name: string }[];
  releases?: { title?: string; date?: string }[];
  tags?: { name: string; count?: number }[];
}

async function fetchMusicBrainz(song: string, artist: string): Promise<MBRecording | null> {
  const q = `recording:"${escape(song)}" AND artist:"${escape(artist)}"`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=1&inc=tags+releases`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { recordings?: MBRecording[] };
    return json.recordings?.[0] ?? null;
  } catch {
    return null;
  }
}

function escape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

function parseYear(date?: string | null): number | null {
  if (!date) return null;
  const match = date.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

// =============================================================================
// Wikipedia summary (CC BY-SA — attribution via url field)
// =============================================================================
async function fetchWikipediaSummary(
  title: string
): Promise<{ url: string; extract: string } | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      type?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (json.type === "disambiguation" || !json.extract) return null;
    const url =
      json.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    return { url, extract: json.extract };
  } catch {
    return null;
  }
}

// =============================================================================
// Discogs (needs DISCOGS_KEY + DISCOGS_SECRET)
// =============================================================================
interface DiscogsCredit {
  role: string;
  name: string;
}

async function fetchDiscogsCredits(
  song: string,
  artist: string
): Promise<DiscogsCredit[] | null> {
  if (!process.env.DISCOGS_KEY || !process.env.DISCOGS_SECRET) {
    return null; // Skip silently when not configured
  }

  const authHeader = `Discogs key=${process.env.DISCOGS_KEY}, secret=${process.env.DISCOGS_SECRET}`;

  try {
    const searchRes = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(
        `${song} ${artist}`
      )}&type=master&per_page=1`,
      {
        headers: { Authorization: authHeader, "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as {
      results?: { resource_url?: string }[];
    };
    const masterUrl = searchJson.results?.[0]?.resource_url;
    if (!masterUrl) return null;

    const masterRes = await fetch(masterUrl, {
      headers: { Authorization: authHeader, "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!masterRes.ok) return null;
    const masterJson = (await masterRes.json()) as {
      tracklist?: { extraartists?: { role?: string; name?: string }[] }[];
      extraartists?: { role?: string; name?: string }[];
    };

    // Prefer per-track extraartists when tracklist is available, otherwise master-level.
    const fromTracks = masterJson.tracklist?.[0]?.extraartists ?? [];
    const fromMaster = masterJson.extraartists ?? [];
    const merged = [...fromTracks, ...fromMaster];

    return merged
      .filter((e): e is { role: string; name: string } => Boolean(e.role && e.name))
      .map(({ role, name }) => ({ role, name }))
      .slice(0, 20);
  } catch {
    return null;
  }
}
