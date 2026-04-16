"use client";

/**
 * Search → Generate → Result flow.
 *
 * Master plan §10.2.
 *
 * 1. Debounced song lookup against MusicBrainz proxy
 * 2. Pick a result (or use raw input as freeform query)
 * 3. Optional section + tone_type narrowing
 * 4. POST /api/research-tone → returns ResearchTone
 * 5. POST /api/adapt-tone with that → returns savedToneId
 * 6. router.push(`/result/${id}`)
 */
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";

interface SongHit {
  mbid: string;
  song: string;
  artist: string;
  year: string | null;
}

const SECTIONS = ["riff", "intro", "verse", "chorus", "solo", "bridge", "outro", "clean_intro"] as const;
const TONE_TYPES = ["", "clean", "crunch", "distorted", "high_gain", "ambient", "acoustic"] as const;

export default function SearchPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SongHit[]>([]);
  const [picked, setPicked] = useState<{ song: string; artist: string } | null>(null);
  const [section, setSection] = useState<typeof SECTIONS[number]>("riff");
  const [toneType, setToneType] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2 || picked?.song === q) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/songs/search?q=${encodeURIComponent(q.trim())}`);
        const json = (await res.json()) as { items: SongHit[] };
        setHits(json.items.slice(0, 8));
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, picked]);

  async function generate() {
    if (!picked) {
      // Allow free-form: split on " by " or " - " or just use the whole string as song.
      const raw = q.trim();
      if (!raw) return;
      const split = raw.split(/\s+(?:by|-|–)\s+/i);
      if (split.length === 2) {
        setPicked({ song: split[0].trim(), artist: split[1].trim() });
      } else {
        setError("Pick a song from the list, or type 'Song by Artist'.");
        return;
      }
    }

    const target = picked ?? { song: q.trim(), artist: "" };
    if (!target.artist) {
      setError("Pick a song from the list, or type 'Song by Artist'.");
      return;
    }

    setError(null);
    setGenerating("Researching tone…");
    try {
      const r1 = await fetch("/api/research-tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          song: target.song,
          artist: target.artist,
          section,
          toneType: toneType || null,
        }),
      });
      const j1 = await r1.json();
      if (!r1.ok || !j1.ok) {
        if (j1.reason === "limit_exceeded") {
          setError(j1.canUpgrade ? "Daily limit reached. Upgrade to Pro for more." : "Daily limit reached.");
        } else if (j1.reason === "rate_limited") {
          setError("Slow down a moment — too many requests.");
        } else {
          setError(j1.error ?? "Couldn't research that tone.");
        }
        setGenerating(null);
        return;
      }

      setGenerating("Adapting to your rig…");
      const r2 = await fetch("/api/adapt-tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          research: j1.data.result ?? j1.data,    // tier_a row vs live response
          songQuery: target.song,
          artistQuery: target.artist,
          referenceToneId: j1.data.id ?? null,
        }),
      });
      const j2 = await r2.json();
      if (!r2.ok || !j2.ok) {
        if (j2.error === "no_gear_onboarded") {
          router.push("/onboarding");
          return;
        }
        setError(j2.error ?? "Couldn't translate to your rig.");
        setGenerating(null);
        return;
      }

      router.push(`/result/${j2.savedToneId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setGenerating(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-12">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">What tone are you chasing?</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Search any song. We&apos;ll translate the tone to your rig.
          </p>
        </header>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
              setError(null);
            }}
            placeholder="Master of Puppets — Metallica"
            disabled={!!generating}
            className="w-full pl-9 pr-3 py-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-60"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-zinc-400" />
          )}
        </div>

        {hits.length > 0 && !picked && (
          <ul className="rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
            {hits.map((h) => (
              <li key={h.mbid}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked({ song: h.song, artist: h.artist });
                    setQ(`${h.song} — ${h.artist}`);
                    setHits([]);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center justify-between gap-2"
                >
                  <span>
                    <span className="font-medium">{h.song}</span>{" "}
                    <span className="text-zinc-500">— {h.artist}</span>
                  </span>
                  {h.year && <span className="text-xs text-zinc-500">{h.year}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Section</span>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value as typeof SECTIONS[number])}
              disabled={!!generating}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
            >
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Tone type (optional)</span>
            <select
              value={toneType}
              onChange={(e) => setToneType(e.target.value)}
              disabled={!!generating}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
            >
              {TONE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t || "auto-detect"}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void generate()}
          disabled={!!generating || (!picked && q.trim().length < 2)}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-3 font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {generating}
            </>
          ) : (
            "Generate tone"
          )}
        </button>

        <p className="text-xs text-zinc-500 text-center">
          Free plan: 3 tones / day. Each request consumes 1 credit.
        </p>
      </div>
    </div>
  );
}
