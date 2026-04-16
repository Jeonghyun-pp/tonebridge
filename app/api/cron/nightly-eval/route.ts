/**
 * GET /api/cron/nightly-eval  (Vercel Cron)
 *
 * Master plan §6.6.10 — daily quality regression check that auto-halts
 * the data pipeline when 5 of the last 7 daily averages drop below 3.5.
 *
 * Authorization:
 *   Vercel Cron sets `Authorization: Bearer <CRON_SECRET>`. We refuse
 *   without it so a curl probe can't enqueue our LLM budget.
 *
 * Schedule: configured in vercel.json — currently 0 2 * * * (UTC).
 */
import { NextResponse, type NextRequest } from "next/server";
import { runEval } from "@/scripts/eval/run";
import { recordEvalRun, recentEvalScores, setHaltFlag } from "@/lib/db/queries";
import { shouldHalt } from "@/lib/community/scoring";

export const runtime = "nodejs";
export const maxDuration = 300;        // 5 min — eval is 5-20 LLM calls

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const summary = await runEval();

  await recordEvalRun({
    avgScore: summary.avgScore,
    results: summary.results,
    modelPrimary: summary.modelPrimary ?? undefined,
  });

  // Halt evaluation: include today's run in the window.
  const recent = await recentEvalScores(7);
  const halted = shouldHalt(recent);
  if (halted) {
    await setHaltFlag(
      `Eval regression: ${recent.length} recent runs avg=${recent.map((s) => s.toFixed(2)).join(",")}`
    );
  }

  return NextResponse.json({
    ok: true,
    avgScore: summary.avgScore,
    songCount: summary.results.length,
    halted,
    recentScores: recent,
  });
}
