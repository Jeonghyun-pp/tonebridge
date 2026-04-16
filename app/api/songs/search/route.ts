/**
 * GET /api/songs/search?q=master+of+puppets
 *
 * Song autocomplete via MusicBrainz public search API.
 * No auth (public). MusicBrainz is CC0 + commercial-use OK; rate limit
 * is 1 req/s per User-Agent so we cache aggressively at the edge.
 *
 * Songsterr would be a richer source (with tab availability), but it
 * requires a commercial license. We default to MusicBrainz so the app
 * is shippable without paid integrations.
 */
import { NextResponse, type NextRequest } from "next/server";
import { lookupLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const revalidate = 3600;     // 1 hour edge cache

const UA = "ToneBridgeApp/1.0 (contact@tonebridge.app)";

interface MBRecording {
  id: string;
  title: string;
  "artist-credit"?: { name: string }[];
  "first-release-date"?: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "10")));
  if (q.length < 2) return NextResponse.json({ items: [] });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
  const rl = await lookupLimit.limit(`songs:${ip}`);
  if (!rl.success) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  try {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return NextResponse.json({ items: [], error: `upstream_${res.status}` });
    }
    const data = (await res.json()) as { recordings?: MBRecording[] };
    const items = (data.recordings ?? []).map((r) => ({
      mbid: r.id,
      song: r.title,
      artist: r["artist-credit"]?.[0]?.name ?? "Unknown",
      year: r["first-release-date"]?.slice(0, 4) ?? null,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ items: [], error: msg });
  }
}
