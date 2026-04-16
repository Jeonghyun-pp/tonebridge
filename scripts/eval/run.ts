/**
 * Eval runner — executes Stage 1 against a fixed set of expected tones,
 * scores each, returns aggregate.
 *
 * Pure orchestration; called from both:
 *   - CLI:  `npm run eval:run`
 *   - Cron: /api/cron/nightly-eval
 *
 * Doesn't touch DB by itself — caller is responsible for persistence.
 */
import fs from "node:fs";
import path from "node:path";
import { researchTone } from "@/lib/llm/research-tone";
import { scoreOne, type ExpectedTone, type ActualTone } from "@/lib/community/scoring";

export interface EvalResult {
  song: string;
  artist: string;
  score: number;
  breakdown: ReturnType<typeof scoreOne>;
  error?: string;
}

export interface EvalRunSummary {
  results: EvalResult[];
  avgScore: number;
  modelPrimary: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
}

const DEFAULT_EVAL_SET = path.join(process.cwd(), "scripts/eval/eval-set.json");

export async function runEval(setPath = DEFAULT_EVAL_SET): Promise<EvalRunSummary> {
  const raw = fs.readFileSync(setPath, "utf-8");
  const evalSet = JSON.parse(raw) as ExpectedTone[];

  const results: EvalResult[] = [];
  let modelPrimary: string | null = null;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const item of evalSet) {
    try {
      const r = await researchTone({
        song: item.song,
        artist: item.artist,
        section: "riff",     // eval set sections vary but research-tone defaults to riff
      });
      modelPrimary ??= r.model;
      totalTokensIn += r.usage.in;
      totalTokensOut += r.usage.out;

      const actual: ActualTone = {
        settings: r.data.settings,
        pedalCategories: r.data.pedals.map((p) => p.category),
        confidence: r.data.overall_confidence,
        playingTips: [],   // Stage 1 doesn't produce playing tips; that's Stage 2
        adaptationNotes: r.data.song_context,
      };

      const breakdown = scoreOne(item.expected, actual);
      results.push({
        song: item.song,
        artist: item.artist,
        score: breakdown.total,
        breakdown,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        song: item.song,
        artist: item.artist,
        score: 0,
        breakdown: { knobs: 0, pedals: 0, tips: 0, confidence: 0, notes: 0, total: 0 },
        error: msg,
      });
    }
  }

  const avgScore = results.length
    ? Math.round((results.reduce((a, r) => a + r.score, 0) / results.length) * 100) / 100
    : 0;

  return { results, avgScore, modelPrimary, totalTokensIn, totalTokensOut };
}

// CLI entrypoint
if (typeof require !== "undefined" && require.main === module) {
  void runEval().then((summary) => {
    console.table(
      summary.results.map((r) => ({
        song: r.song,
        artist: r.artist,
        score: r.score,
        ...(r.error ? { error: r.error.slice(0, 60) } : {}),
      }))
    );
    console.log(`\nAvg: ${summary.avgScore}/5.0 (${summary.results.length} songs)`);
    console.log(`Tokens: ${summary.totalTokensIn} in / ${summary.totalTokensOut} out`);
    process.exit(summary.avgScore >= 3.5 ? 0 : 1);
  });
}
