/**
 * Tier A Zero-Human driver — orchestrates Phase 0-6 per seed.
 *
 * Master plan §6.6.11.  Reads the curated seed JSON, runs each song through
 * the extraction → normalize → score → dual-judge pipeline, and inserts into
 * `reference_tones` (or routes to Tier B fallback on rejection).
 *
 * Concurrency is set to 2 to stay well inside Gemini's 15 RPM free quota
 * while still keeping the 290-song run inside a single workday.
 *
 * CLI:
 *   npm run run:tier-a                      # full tier_a_seeds.json
 *   npm run run:tier-a -- --pilot           # tier_a_pilot_seeds.json
 *   npm run run:tier-a -- --day=1           # first 150 of full seeds
 *   npm run run:tier-a -- --day=2           # rest (index 150+)
 *   npm run run:tier-a -- --count=10        # first 10 only (smoke)
 *   npm run run:tier-a -- --input=path
 *   npm run run:tier-a -- --dry-run         # no DB writes, log decisions only
 *
 * Observability:
 *   - per-seed: single line with decision + reason
 *   - final: decision distribution + token usage + wall time
 *   - exit code = 1 when reject rate > 50% (alerts ops without needing email)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";

import { wikiFirstExtract } from "@/lib/automation/phase0-wiki-first";
import { discoverSourcesBrave } from "@/lib/automation/phase2-brave";
import { fetchAllWithGuard, stripHtml } from "@/lib/automation/fetch-guard";
import { extractWithConsensus } from "@/lib/automation/phase3-multi-llm";
import { normalizeGear, type NormalizedGear } from "@/lib/automation/phase4-normalize";
import { scoreTone, type Mode } from "@/lib/automation/phase5-score";
import {
  dualJudge,
  decideDualJudge,
  explainDecision,
  type Decision,
} from "@/lib/automation/phase6-dual-judge";
import {
  generateTierB,
  tierBToReferenceTone,
} from "@/lib/automation/tier-b-fallback";
import type { Extraction, SearchResult } from "@/lib/automation/schemas";
import { assertNoRawContent } from "@/lib/automation/storage-guard";

import {
  checkHaltFlag,
  insertReferenceTone,
  logRejection,
} from "@/lib/db/queries";
import type { NewReferenceTone } from "@/lib/db/schema";

// =============================================================================
// Types
// =============================================================================
type Section =
  | "intro"
  | "verse"
  | "chorus"
  | "riff"
  | "solo"
  | "bridge"
  | "outro"
  | "clean_intro";

interface Seed {
  song: string;
  artist: string;
  section?: Section;
}

interface ProcessResult {
  seed: Seed;
  decision: Decision | "tier_b_no_sources" | "tier_b_extraction_failed" | "error";
  reason: string;
  tokensIn: number;
  tokensOut: number;
  mode?: Mode;
  confidence?: number;
  sourceCount?: number;
}

// =============================================================================
// Per-seed pipeline
// =============================================================================
async function processOne(seed: Seed, dryRun: boolean): Promise<ProcessResult> {
  const section: Section = seed.section ?? "riff";
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    // -- Phase 0: Wikipedia-first ---------------------------------------------
    const wiki = await wikiFirstExtract(seed.song, seed.artist);
    tokensIn += wiki.tokenUsage.in;
    tokensOut += wiki.tokenUsage.out;

    let extraction: Extraction;
    let sources: SearchResult[];
    let phaseTag: "wiki" | "brave";

    if (wiki.sufficient && wiki.extraction) {
      phaseTag = "wiki";
      extraction = wikiToExtraction(wiki.extraction, seed.song, seed.artist);
      sources = wikiSourcesToSearchResults(wiki.extraction.sources);
    } else {
      // -- Phase 2: Brave Search ----------------------------------------------
      phaseTag = "brave";
      sources = await discoverSourcesBrave(seed.song, seed.artist);
      if (sources.length === 0) {
        return await tierBFallback(seed, "no_sources", dryRun, tokensIn, tokensOut);
      }

      // Fetch the top sources (cap at 10 to respect budget).
      const topSources = sources.slice(0, 10);
      const fetches = await fetchAllWithGuard(topSources.map((s) => s.url));
      const fetchedTextBySource: Array<
        { url: string; title: string; tier: 1 | 2 | 3; text: string }
      > = [];
      for (let i = 0; i < topSources.length; i++) {
        const f = fetches[i];
        const s = topSources[i];
        if (!f.text) continue;
        const text = stripHtml(f.text);
        if (text.length < 200) continue;
        fetchedTextBySource.push({ url: s.url, title: s.title, tier: s.tier, text });
      }

      if (fetchedTextBySource.length === 0) {
        return await tierBFallback(seed, "all_fetches_empty", dryRun, tokensIn, tokensOut);
      }

      // -- Phase 3: Multi-LLM consensus ---------------------------------------
      try {
        const consensus = await extractWithConsensus({
          song: seed.song,
          artist: seed.artist,
          sources: fetchedTextBySource,
        });
        tokensIn += consensus.token_usage.in;
        tokensOut += consensus.token_usage.out;
        extraction = consensus.extraction;
        // Keep only sources the pipeline actually considered; re-index for citations.
        sources = fetchedTextBySource.map((s) => ({
          url: s.url,
          title: s.title,
          snippet: "",
          tier: s.tier,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return await tierBFallback(
          seed,
          `consensus_failed: ${msg.slice(0, 120)}`,
          dryRun,
          tokensIn,
          tokensOut
        );
      }
    }

    // -- Phase 4: Normalize gear to DB IDs -----------------------------------
    const normalized = await normalizeGear(extraction);

    // -- Phase 5: Score + mode decision --------------------------------------
    const score = scoreTone(extraction, sources);

    // -- Phase 6: Dual-Judge -------------------------------------------------
    const candidate = {
      song: seed.song,
      artist: seed.artist,
      extraction,
      sources,
      auto_mode: score.mode,
      auto_confidence: score.confidence,
    };
    const judges = await dualJudge(candidate);
    const decision = decideDualJudge(candidate, judges);

    if (decision === "reject") {
      if (!dryRun) {
        await logRejection({
          song: seed.song,
          artist: seed.artist,
          section,
          reason: explainDecision(candidate, judges, decision),
          extraction,
          sources,
          judges,
          fallbackAction: "tier_b_generate",
        });
      }
      return await tierBFallback(
        seed,
        `phase6_reject (${phaseTag})`,
        dryRun,
        tokensIn,
        tokensOut
      );
    }

    // -- Insert approved extraction -----------------------------------------
    const finalMode: Mode = decision === "approve_authoritative" ? "authoritative" : "inferred";
    const row = extractionToReferenceTone({
      song: seed.song,
      artist: seed.artist,
      section,
      extraction,
      normalized,
      mode: finalMode,
      confidence: decision === "approve_authoritative" ? score.confidence : Math.min(score.confidence, 0.7),
      sources,
    });

    if (!dryRun) {
      assertNoRawContent(row);
      await insertReferenceTone(row);
    }

    return {
      seed,
      decision,
      reason: `${phaseTag} · mode=${finalMode} · conf=${score.confidence.toFixed(2)} · t1=${score.tier_counts.t1}/t2=${score.tier_counts.t2}/t3=${score.tier_counts.t3}`,
      tokensIn,
      tokensOut,
      mode: finalMode,
      confidence: score.confidence,
      sourceCount: sources.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      seed,
      decision: "error",
      reason: msg.slice(0, 200),
      tokensIn,
      tokensOut,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================
async function tierBFallback(
  seed: Seed,
  reason: string,
  dryRun: boolean,
  tokensIn: number,
  tokensOut: number
): Promise<ProcessResult> {
  try {
    const fb = await generateTierB(seed.song, seed.artist);
    const row = tierBToReferenceTone(fb.generation);
    if (!dryRun) {
      assertNoRawContent(row);
      await insertReferenceTone(row);
    }
    return {
      seed,
      decision: "tier_b_no_sources",
      reason: `tier_b_generated (${reason})`,
      tokensIn: tokensIn + fb.token_usage.in,
      tokensOut: tokensOut + fb.token_usage.out,
      mode: "inferred",
      confidence: Number(row.confidence ?? 0),
      sourceCount: 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      seed,
      decision: "tier_b_extraction_failed",
      reason: `${reason} → tier_b_error: ${msg.slice(0, 120)}`,
      tokensIn,
      tokensOut,
    };
  }
}

/**
 * Lift a Wikipedia-first extraction (single source) into the Phase-3 canonical
 * shape so Phase 4/5/6 can treat it uniformly. Source URLs become indices
 * 0..N-1; every cited fact points to the URL it was drawn from.
 */
function wikiToExtraction(
  wiki: {
    guitar: { brand: string | null; model: string | null; pickup_config: string | null; source_url: string | null } | null;
    amp: { brand: string | null; model: string | null; source_url: string | null } | null;
    pedals: Array<{ brand: string | null; model: string; category: string; source_url: string | null }>;
    tone_description: string | null;
    sources: string[];
    confidence: number;
  },
  song: string,
  artist: string
): Extraction {
  const urlToIndex = new Map<string, number>();
  wiki.sources.forEach((u, i) => urlToIndex.set(u, i));
  const cite = (url: string | null | undefined): number[] =>
    url && urlToIndex.has(url) ? [urlToIndex.get(url)!] : [];

  return {
    song,
    artist,
    guitar: {
      brand: wiki.guitar?.brand ?? null,
      model: wiki.guitar?.model ?? null,
      pickup_config: wiki.guitar?.pickup_config ?? null,
      year: null,
      source_indices: cite(wiki.guitar?.source_url),
      confidence: wiki.confidence,
    },
    amp: {
      brand: wiki.amp?.brand ?? null,
      model: wiki.amp?.model ?? null,
      source_indices: cite(wiki.amp?.source_url),
      confidence: wiki.confidence,
    },
    pedals: wiki.pedals.map((p) => ({
      category: p.category,
      brand: p.brand,
      model: p.model,
      position_in_chain: null,
      purpose: null,
      source_indices: cite(p.source_url),
      confidence: wiki.confidence,
    })),
    settings: null, // Wikipedia rarely quotes knob values
    pickup_choice: null,
    tone_characteristics: [],
    extraction_notes: (wiki.tone_description ?? "").slice(0, 500),
    overall_confidence: wiki.confidence,
  };
}

function wikiSourcesToSearchResults(urls: string[]): SearchResult[] {
  return urls.map((url) => ({
    url,
    title: "Wikipedia",
    snippet: "",
    tier: 2 as const,
  }));
}

/**
 * Shape a Phase-3/Phase-6-approved Extraction into a reference_tones insert.
 * referenceSettings is NOT NULL, so when the LLM didn't extract numeric knob
 * values we publish neutral 5/5/5/5 and let the mode + confidence signal the
 * uncertainty to the caller.
 */
function extractionToReferenceTone(args: {
  song: string;
  artist: string;
  section: Section;
  extraction: Extraction;
  normalized: NormalizedGear;
  mode: Mode;
  confidence: number;
  sources: SearchResult[];
}): NewReferenceTone {
  const { extraction, normalized, sources } = args;

  const settings = extraction.settings
    ? {
        gain: extraction.settings.gain ?? 5,
        bass: extraction.settings.bass ?? 5,
        mid: extraction.settings.mid ?? 5,
        treble: extraction.settings.treble ?? 5,
        presence: extraction.settings.presence ?? null,
        reverb: extraction.settings.reverb ?? null,
      }
    : { gain: 5, bass: 5, mid: 5, treble: 5, presence: null, reverb: null };

  const citeUrls = (idxs: number[]): string[] =>
    idxs.map((i) => sources[i]?.url).filter((u): u is string => typeof u === "string");

  return {
    song: args.song,
    artist: args.artist,
    section: args.section,
    referenceGuitarId: normalized.guitar.id ?? undefined,
    referenceGuitarFreetext: normalized.guitar.freetext,
    referenceAmpId: normalized.amp.id ?? undefined,
    referenceAmpFreetext: normalized.amp.freetext,
    referencePedals: extraction.pedals.map((p, i) => {
      const norm = normalized.pedals[i];
      return {
        pedal_id: norm?.id ?? undefined,
        brand: p.brand ?? undefined,
        model: p.model,
        category: p.category,
        position_in_chain: p.position_in_chain ?? i + 1,
        purpose: p.purpose,
        confidence: p.confidence,
        sources: citeUrls(p.source_indices),
      };
    }),
    referenceSettings: settings,
    pickupChoice: extraction.pickup_choice?.value ?? undefined,
    toneCharacteristics: extraction.tone_characteristics,
    songContext: extraction.extraction_notes,
    sources: sources.map((s) => s.url),
    confidence: args.confidence.toFixed(2),
    mode: args.mode,
  };
}

// =============================================================================
// CLI
// =============================================================================
interface Args {
  pilot: boolean;
  count: number | null;
  day: 1 | 2 | null;
  inputPath: string | null;
  concurrency: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    pilot: false,
    count: null,
    day: null,
    inputPath: null,
    concurrency: 2,
    dryRun: false,
  };
  for (const a of argv.slice(2)) {
    if (a === "--pilot") args.pilot = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--count=")) {
      const n = Number(a.slice("--count=".length));
      if (Number.isFinite(n) && n > 0) args.count = n;
    } else if (a.startsWith("--day=")) {
      const n = Number(a.slice("--day=".length));
      if (n === 1 || n === 2) args.day = n;
    } else if (a.startsWith("--input=")) args.inputPath = a.slice("--input=".length);
    else if (a.startsWith("--concurrency=")) {
      const n = Number(a.slice("--concurrency=".length));
      if (Number.isFinite(n) && n > 0 && n <= 5) args.concurrency = n;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.warn(`[args] ignoring unknown flag: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`run-tier-a-zero-human — drive Phase 0-6 pipeline over seed list

Flags:
  --pilot            use tier_a_pilot_seeds.json
  --day=1|2          split full seeds into halves (respects Gemini 1,500/day)
  --count=N          process first N seeds only (smoke)
  --input=<path>     override input JSON
  --concurrency=N    parallel seeds (default 2, max 5)
  --dry-run          log decisions, do not write to DB
  --help, -h         show this help`);
}

function resolveInput(args: Args): string {
  if (args.inputPath) return args.inputPath;
  const dir = path.join(process.cwd(), "scripts/seed/data");
  return args.pilot
    ? path.join(dir, "tier_a_pilot_seeds.json")
    : path.join(dir, "tier_a_seeds.json");
}

function sliceByDay(seeds: Seed[], day: 1 | 2): Seed[] {
  // Day 1 gets the first 150 to fit Gemini's 1,500 req/day ceiling at ~10 req/song.
  const cut = 150;
  return day === 1 ? seeds.slice(0, cut) : seeds.slice(cut);
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = resolveInput(args);

  if (!fs.existsSync(inputPath)) {
    console.error(
      `❌ Seed file not found: ${path.relative(process.cwd(), inputPath)}\n` +
        `   Run: npm run seed:tier-a-list${args.pilot ? " -- --pilot" : ""}`
    );
    process.exit(1);
  }

  const rawSeeds = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as Seed[];
  let seeds = rawSeeds;
  if (args.day !== null) seeds = sliceByDay(seeds, args.day);
  if (args.count !== null) seeds = seeds.slice(0, args.count);

  if (seeds.length === 0) {
    console.error(`❌ 0 seeds after filters. input=${inputPath}`);
    process.exit(1);
  }

  // Halt guard: refuse to start when nightly eval has flagged a regression.
  if (!args.dryRun) {
    try {
      await checkHaltFlag();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log(
    `▶ run-tier-a: ${seeds.length} seeds · input=${path.relative(
      process.cwd(),
      inputPath
    )}${args.dryRun ? " · DRY RUN" : ""}`
  );

  const startedAt = Date.now();
  const limit = pLimit(args.concurrency);
  let done = 0;

  const results = await Promise.all(
    seeds.map((s) =>
      limit(async () => {
        const r = await processOne(s, args.dryRun);
        done++;
        const tag = typeof r.decision === "string" ? r.decision : "?";
        console.log(
          `[${done}/${seeds.length}] ${s.artist} — ${s.song} :: ${tag} :: ${r.reason}`
        );
        return r;
      })
    )
  );

  // -- Summary ---------------------------------------------------------------
  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const buckets = bucketByDecision(results);
  const totals = results.reduce(
    (acc, r) => ({ in: acc.in + r.tokensIn, out: acc.out + r.tokensOut }),
    { in: 0, out: 0 }
  );

  console.log("\n──────────────── summary ────────────────");
  console.table(buckets);
  console.log(`tokens: ${totals.in.toLocaleString()} in / ${totals.out.toLocaleString()} out`);
  console.log(`wall:   ${elapsedMin} min`);

  const authPct = (buckets.approve_authoritative / results.length) * 100;
  const rejectPct =
    ((buckets.reject ?? 0) + (buckets.tier_b_no_sources ?? 0) + (buckets.tier_b_extraction_failed ?? 0)) /
    results.length *
    100;
  console.log(`\nauth rate: ${authPct.toFixed(1)}%   ·   reject/tier-b rate: ${rejectPct.toFixed(1)}%`);

  // Exit non-zero when reject rate exceeds Go-gate threshold — CI-friendly.
  if (rejectPct > 50) {
    console.error("\n⚠  reject/tier-b rate > 50% — Go-gate review recommended before advancing to S8.");
    process.exit(2);
  }
}

function bucketByDecision(results: ProcessResult[]): Record<string, number> {
  const acc: Record<string, number> = {
    approve_authoritative: 0,
    approve_inferred: 0,
    reject: 0,
    tier_b_no_sources: 0,
    tier_b_extraction_failed: 0,
    error: 0,
  };
  for (const r of results) {
    const key = String(r.decision);
    acc[key] = (acc[key] ?? 0) + 1;
  }
  return acc;
}

main().catch((err) => {
  console.error("[run-tier-a] fatal:", err);
  process.exit(1);
});
