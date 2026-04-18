/**
 * Tier B batch generator — Gemini Free loop for the large-scale LLM-only corpus.
 *
 * Master plan §6.6 — Tier B = "catalog coverage at the cost of provenance."
 * Every song produced here is mode='inferred' with confidence ≤ 0.5 and no
 * cited sources (§6.6.3, tier-b-fallback.ts). The UX surfaces this as a
 * `⚠ Inferred` badge so users can calibrate trust.
 *
 * Why not OpenAI Batch? The Zero-Cost Track runs on Gemini 1.5 Flash (1,500
 * req/day free). A steady 10 RPM loop burns exactly one day's quota over
 * ~2.5 hours per 1,500 songs — fits comfortably below the rate limit.
 *
 * CLI:
 *   npm run run:tier-b                    # full tier_b_seeds.json
 *   npm run run:tier-b -- --count=200     # first 200 only
 *   npm run run:tier-b -- --offset=500    # skip first 500 (resume)
 *   npm run run:tier-b -- --input=path
 *   npm run run:tier-b -- --dry-run       # generate + log, no DB writes
 *   npm run run:tier-b -- --rpm=15        # override pacing (default 10)
 *
 * Resume strategy: no checkpointing yet; use --offset=N to continue after a
 * crash.  Duplicate inserts are idempotent via ON CONFLICT DO UPDATE
 * (unique key: song+artist+section+tone_type+instrument).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { generateTierB, tierBToReferenceTone } from "@/lib/automation/tier-b-fallback";
import { checkHaltFlag, insertReferenceTone } from "@/lib/db/queries";
import { assertNoRawContent } from "@/lib/automation/storage-guard";

interface Seed {
  song: string;
  artist: string;
}

interface Args {
  count: number | null;
  offset: number;
  inputPath: string | null;
  dryRun: boolean;
  rpm: number;
  haltCheckEvery: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    count: null,
    offset: 0,
    inputPath: null,
    dryRun: false,
    rpm: 10,
    haltCheckEvery: 50,
  };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--count=")) {
      const n = Number(a.slice("--count=".length));
      if (Number.isFinite(n) && n > 0) args.count = n;
    } else if (a.startsWith("--offset=")) {
      const n = Number(a.slice("--offset=".length));
      if (Number.isFinite(n) && n >= 0) args.offset = n;
    } else if (a.startsWith("--input=")) args.inputPath = a.slice("--input=".length);
    else if (a.startsWith("--rpm=")) {
      const n = Number(a.slice("--rpm=".length));
      // Cap at 13 — Gemini free is 15 RPM, we leave headroom for retries.
      if (Number.isFinite(n) && n > 0 && n <= 13) args.rpm = n;
    } else if (a === "--help" || a === "-h") {
      console.log(`tier_b_batch — generate Tier B reference tones via Gemini Free loop

Flags:
  --count=N          process N seeds then stop
  --offset=N         skip first N seeds (resume after crash)
  --input=<path>     override input (default: scripts/seed/data/tier_b_seeds.json)
  --rpm=N            pacing target (default 10, max 13)
  --dry-run          generate + log, no DB writes`);
      process.exit(0);
    }
  }
  return args;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath =
    args.inputPath ?? path.join(process.cwd(), "scripts/seed/data/tier_b_seeds.json");

  if (!fs.existsSync(inputPath)) {
    console.error(
      `❌ Seed file not found: ${path.relative(process.cwd(), inputPath)}\n` +
        `   Run: npm run seed:tier-a-list -- --tier-b`
    );
    process.exit(1);
  }

  const all = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as Seed[];
  const window = args.count !== null
    ? all.slice(args.offset, args.offset + args.count)
    : all.slice(args.offset);

  if (window.length === 0) {
    console.error(`❌ 0 seeds after offset/count. total=${all.length}`);
    process.exit(1);
  }

  if (!args.dryRun) {
    try {
      await checkHaltFlag();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  const paceMs = Math.ceil(60_000 / args.rpm);
  console.log(
    `▶ tier-b: ${window.length} seeds · offset=${args.offset} · pacing=${args.rpm} rpm` +
      ` (${paceMs} ms/req)${args.dryRun ? " · DRY RUN" : ""}`
  );
  console.log(`   input=${path.relative(process.cwd(), inputPath)}   total catalog=${all.length}`);

  const startedAt = Date.now();
  const stats = { ok: 0, err: 0, tokensIn: 0, tokensOut: 0 };

  for (let i = 0; i < window.length; i++) {
    const seed = window[i];
    const absoluteIdx = args.offset + i;
    const callStart = Date.now();

    // Periodic halt check so a regression detected mid-run stops us promptly.
    if (!args.dryRun && i > 0 && i % args.haltCheckEvery === 0) {
      try {
        await checkHaltFlag();
      } catch (err) {
        console.error(`[tier-b] halt flag tripped at seed ${absoluteIdx}`);
        console.error(err instanceof Error ? err.message : String(err));
        break;
      }
    }

    try {
      const fb = await generateTierB(seed.song, seed.artist);
      stats.tokensIn += fb.token_usage.in;
      stats.tokensOut += fb.token_usage.out;

      if (!args.dryRun) {
        const row = tierBToReferenceTone(fb.generation);
        assertNoRawContent(row);
        await insertReferenceTone(row);
      }

      stats.ok++;
      console.log(
        `[${absoluteIdx + 1}/${all.length}] ✓ ${seed.artist} — ${seed.song}   conf=${fb.generation.confidence.toFixed(2)}`
      );
    } catch (err) {
      stats.err++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${absoluteIdx + 1}/${all.length}] ✗ ${seed.artist} — ${seed.song}   ${msg.slice(0, 120)}`);
    }

    const elapsed = Date.now() - callStart;
    await sleep(paceMs - elapsed);
  }

  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log("\n──────────────── summary ────────────────");
  console.log(`ok:     ${stats.ok}`);
  console.log(`err:    ${stats.err}`);
  console.log(`tokens: ${stats.tokensIn.toLocaleString()} in / ${stats.tokensOut.toLocaleString()} out`);
  console.log(`wall:   ${elapsedMin} min`);

  if (stats.err > stats.ok * 0.2) {
    console.error(
      `\n⚠  error rate > 20% (${stats.err}/${stats.ok + stats.err}) — check Gemini quota and prompt stability.`
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[tier-b] fatal:", err);
  process.exit(1);
});
