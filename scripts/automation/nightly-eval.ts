/**
 * Nightly eval runner — CLI twin of /api/cron/nightly-eval.
 *
 * Master plan §6.6.10.  Runs the 20-song regression set, records the average
 * to `eval_history`, and trips the halt flag when 5 of the last 7 days fall
 * below THRESHOLD (3.5/5.0). Used in two contexts:
 *
 *   - Vercel Cron — the API route calls this same `runEval` + `recordEvalRun`
 *     combination on the server, authenticated by CRON_SECRET.
 *   - Local / CI — `npm run eval:nightly` or a GitHub Actions workflow that
 *     needs DB credentials but no public web surface.
 *
 * Why duplicate the cron route? The route is Next.js-specific (NextResponse,
 * request headers, edge auth). A plain CLI is easier to invoke from CI, cron,
 * and local debugging without spinning up the whole Next server.
 *
 * CLI:
 *   npm run eval:nightly                # full pipeline + DB record + halt check
 *   npm run eval:nightly -- --dry-run   # run eval, log result, no DB writes
 *   npm run eval:nightly -- --no-halt   # record but never trip the halt flag
 */
import "dotenv/config";
import { runEval } from "@/scripts/eval/run";
import { shouldHalt, THRESHOLD } from "@/lib/community/scoring";
import {
  recordEvalRun,
  recentEvalScores,
  setHaltFlag,
} from "@/lib/db/queries";

interface Args {
  dryRun: boolean;
  noHalt: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, noHalt: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-halt") args.noHalt = true;
    else if (a === "--help" || a === "-h") {
      console.log(`nightly-eval — run eval set, record history, trip halt on regression

Flags:
  --dry-run     run eval only; no DB writes.
  --no-halt     record history but skip halt-flag trip.`);
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("▶ running eval set…");
  const summary = await runEval();

  console.table(
    summary.results.map((r) => ({
      song: r.song,
      artist: r.artist,
      score: r.score,
      ...(r.error ? { error: r.error.slice(0, 60) } : {}),
    }))
  );
  console.log(
    `\navg: ${summary.avgScore}/5.0   (${summary.results.length} songs)` +
      `   model=${summary.modelPrimary ?? "n/a"}   tokens=${summary.totalTokensIn}→${summary.totalTokensOut}`
  );

  if (args.dryRun) {
    console.log("dry run — skipping DB writes");
    process.exit(summary.avgScore >= THRESHOLD ? 0 : 1);
  }

  await recordEvalRun({
    avgScore: summary.avgScore,
    results: summary.results,
    modelPrimary: summary.modelPrimary ?? undefined,
  });

  const recent = await recentEvalScores(7);
  console.log(`recent 7 runs (newest first): ${recent.map((s) => s.toFixed(2)).join(", ")}`);

  const halted = !args.noHalt && shouldHalt(recent);
  if (halted) {
    await setHaltFlag(
      `Eval regression: recent=${recent.map((s) => s.toFixed(2)).join(",")}  threshold=${THRESHOLD}`
    );
    console.error(
      `\n🚨 HALT — 5 of last 7 averages below ${THRESHOLD}. ` +
        `Auto-insertion blocked until system_flags.auto_insertion_halted is cleared.`
    );
    process.exit(2);
  }

  console.log(
    summary.avgScore >= THRESHOLD
      ? `✅ above threshold (${THRESHOLD})`
      : `⚠  below threshold (${THRESHOLD}) — not yet halting (need 5/7)`
  );
  process.exit(summary.avgScore >= THRESHOLD ? 0 : 1);
}

main().catch((err) => {
  console.error("[nightly-eval] fatal:", err);
  process.exit(1);
});
