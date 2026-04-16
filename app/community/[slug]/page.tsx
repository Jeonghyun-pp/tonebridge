/**
 * /community/[slug]  — public reference tone detail page.
 *
 * SEO surface: full title, description, OG image, JSON-LD via metadata API.
 * Renders the Stage 1 tone profile but NOT the Stage 2 adaptation
 * (that requires login + onboarded gear).
 *
 * Master plan §11.1.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { referenceTones } from "@/lib/db/schema";
import { parseSlug, toSlug } from "@/lib/community/slug";
import { ConfidenceBadge } from "@/components/result-card/confidence-badge";
import { AmpKnobs } from "@/components/result-card/amp-knobs";

export const revalidate = 3600;

interface Params {
  params: Promise<{ slug: string }>;
}

async function loadTone(slug: string) {
  const parsed = parseSlug(slug);
  if (!parsed) return null;

  const conditions = [
    sql`lower(${referenceTones.song}) = lower(${parsed.song})`,
    sql`lower(${referenceTones.artist}) = lower(${parsed.artist})`,
    eq(referenceTones.section, parsed.section),
    eq(referenceTones.instrument, parsed.instrument),
  ];
  if (parsed.toneType) {
    conditions.push(eq(referenceTones.toneType, parsed.toneType));
  }

  const rows = await db
    .select()
    .from(referenceTones)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: "Tone not found" };
  const title = `${parsed.song} — ${parsed.artist} · Tone Recipe`;
  const description = `${parsed.section.replace("_", " ")}${
    parsed.toneType ? ` · ${parsed.toneType}` : ""
  } guitar tone for "${parsed.song}" by ${parsed.artist}: amp settings, pedal chain, and pickup choice.`;

  const ogUrl = `/api/og?song=${encodeURIComponent(parsed.song)}&artist=${encodeURIComponent(parsed.artist)}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogUrl] },
  };
}

interface PedalLite {
  brand?: string;
  model?: string | null;
  category: string;
  position_in_chain?: number;
  purpose?: string | null;
}

export default async function CommunityTonePage({ params }: Params) {
  const { slug } = await params;
  const tone = await loadTone(slug);
  if (!tone) notFound();

  const settings = tone.referenceSettings;
  const pedals: PedalLite[] = (tone.referencePedals as PedalLite[] | null) ?? [];

  return (
    <main className="flex flex-1 justify-center px-6 py-10">
      <article className="w-full max-w-3xl flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <ConfidenceBadge
              mode={tone.mode}
              confidence={tone.confidence ? Number(tone.confidence) : null}
            />
            <span className="text-xs uppercase tracking-wide text-zinc-500">{tone.section}</span>
            {tone.toneType && (
              <span className="text-xs uppercase tracking-wide text-zinc-500">· {tone.toneType}</span>
            )}
            {tone.genre && (
              <span className="text-xs uppercase tracking-wide text-zinc-500">· {tone.genre}</span>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {tone.song} <span className="text-zinc-500">— {tone.artist}</span>
          </h1>
          {tone.songContext && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-prose">
              {tone.songContext}
            </p>
          )}
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Original rig
          </h2>
          <div className="text-sm flex flex-wrap gap-x-6 gap-y-1">
            <Field label="Guitar">{tone.referenceGuitarFreetext ?? "—"}</Field>
            <Field label="Amp">{tone.referenceAmpFreetext ?? "—"}</Field>
            {tone.pickupChoice && <Field label="Pickup">{tone.pickupChoice}</Field>}
          </div>
        </section>

        <AmpKnobs values={settings} />

        {pedals.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Pedal chain
            </h2>
            <ol className="text-sm space-y-1">
              {pedals
                .slice()
                .sort((a, b) => (a.position_in_chain ?? 99) - (b.position_in_chain ?? 99))
                .map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-zinc-500 tabular-nums">
                      {p.position_in_chain ?? i + 1}.
                    </span>
                    <span>
                      <span className="font-medium">{p.brand ?? "Generic"}</span>{" "}
                      <span className="text-zinc-600 dark:text-zinc-400">{p.model ?? p.category}</span>
                      {p.purpose && (
                        <span className="text-xs text-zinc-500"> — {p.purpose}</span>
                      )}
                    </span>
                  </li>
                ))}
            </ol>
          </section>
        )}

        {tone.sources && tone.sources.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Sources
            </h2>
            <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1 break-all">
              {tone.sources.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <aside className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-5 flex flex-col items-start gap-3">
          <h3 className="text-lg font-semibold">Want this on your rig?</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sign in and we&apos;ll translate these settings to your specific guitar and amp,
            adjusting for pickup output and amp voicing.
          </p>
          <Link
            href={`/auth/signin?redirect=${encodeURIComponent(`/search?q=${tone.song}`)}`}
            className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Adapt to my gear
          </Link>
        </aside>

        <footer className="text-xs text-zinc-500">
          Tones are starting points — confidence badges show how strongly the recipe is sourced.
          Tune by ear from there.
        </footer>
      </article>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>{" "}
      <span className="font-semibold">{children}</span>
    </div>
  );
}

// Re-export toSlug as `_unused` to keep tree-shaking happy when sitemap imports
// it from the same module elsewhere.
void toSlug;
