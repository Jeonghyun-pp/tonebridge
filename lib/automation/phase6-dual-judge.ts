/**
 * Phase 6 — Dual-Judge consensus.
 *
 * Master plan §6.6.8 / DATA-AUTOMATION §19.5.
 *
 * Runs two independent judges (Gemini + Groq) on the Phase-3-merged
 * extraction, each verifying per-field citation validity against the
 * sources. The decision function then distills both judges' verdicts
 * into a 3-way outcome:
 *
 *   approve_authoritative  — both judges PASS + both suggest 'authoritative'
 *                            + no FAIL verdict + autoConfidence ≥ 0.7
 *   approve_inferred       — at least one judge PASS + no FAIL verdict
 *                            + autoConfidence ≥ 0.4
 *   reject                 — otherwise (caller sends to Tier B fallback)
 *
 * The `no FAIL verdict` guard is what makes this Zero-Human tolerable:
 * an explicit citation-hallucination in either judge blocks insertion.
 */
import { completeFromZod, LLMError } from "@/lib/llm/provider";
import { JudgeSchema, type Extraction, type JudgeResult, type SearchResult } from "./schemas";
import type { Mode } from "./phase5-score";

const JUDGE_SYSTEM = `You audit citation validity.

Given an extraction and the full list of sources, verify for every field carrying source_indices
whether the cited source(s) actually contain or clearly imply the claim.

Per-field verdicts:
  PASS     — the cited source(s) explicitly support the claim
  PARTIAL  — the cited source mentions the topic but ambiguously or partially
  FAIL     — the cited source does NOT contain the fact (citation hallucination)

Set overall_pass=true only if:
  - NO field is FAIL, AND
  - at least 60% of graded fields are PASS.

suggested_mode:
  'authoritative' — only if ≥2 PASS verdicts are backed by Tier-1 sources
  'inferred'      — when Tier-2-backed PASS verdicts dominate
  'speculative'   — when most verdicts are PARTIAL or sources are Tier-3

suggested_confidence: estimate the reliability of the extraction as a whole
based on verdict distribution.

Be strict: when in doubt, choose PARTIAL over PASS.`;

// =============================================================================
// Public API
// =============================================================================

export interface Candidate {
  song: string;
  artist: string;
  extraction: Extraction;
  sources: SearchResult[];
  auto_mode: Mode;
  auto_confidence: number;
}

export interface Judges {
  j1: JudgeResult | null;     // Gemini; null if the call failed
  j2: JudgeResult | null;     // Groq; null if the call failed
}

export type Decision = "approve_authoritative" | "approve_inferred" | "reject";

/**
 * Run both judges in parallel. If either fails, that verdict is null and the
 * decision function treats missing judges as a non-pass (strict).
 */
export async function dualJudge(cand: Candidate): Promise<Judges> {
  const payload = {
    song: cand.song,
    artist: cand.artist,
    extraction: cand.extraction,
    sources: cand.sources.map((s, i) => ({ index: i, url: s.url, title: s.title, tier: s.tier, snippet: s.snippet })),
  };
  const userMsg = JSON.stringify(payload);

  const shared = {
    system: JUDGE_SYSTEM,
    user: userMsg,
    schema: JudgeSchema,
    schemaName: "Judge",
    temperature: 0,
  } as const;

  const [gRes, grRes] = await Promise.allSettled([
    completeFromZod({ ...shared, provider: "gemini" }),
    completeFromZod({ ...shared, provider: "groq" }),
  ]);

  return {
    j1: gRes.status === "fulfilled" ? gRes.value.data : null,
    j2: grRes.status === "fulfilled" ? grRes.value.data : null,
  };
}

/**
 * Pure function — decide what to do with the candidate given both judge verdicts.
 * Strict: missing judges are treated as non-pass.
 */
export function decideDualJudge(cand: Candidate, judges: Judges): Decision {
  const { j1, j2 } = judges;

  // Any explicit FAIL blocks everything.
  const anyFail =
    (j1?.field_verdicts ?? []).some((v) => v.verdict === "FAIL") ||
    (j2?.field_verdicts ?? []).some((v) => v.verdict === "FAIL");
  if (anyFail) return "reject";

  const bothPass = Boolean(j1?.overall_pass && j2?.overall_pass);
  const bothAuth = j1?.suggested_mode === "authoritative" && j2?.suggested_mode === "authoritative";

  if (bothPass && bothAuth && cand.auto_mode === "authoritative" && cand.auto_confidence >= 0.7) {
    return "approve_authoritative";
  }

  const oneFullPass = Boolean(j1?.overall_pass) || Boolean(j2?.overall_pass);
  if (oneFullPass && cand.auto_confidence >= 0.4) {
    return "approve_inferred";
  }

  return "reject";
}

/**
 * Tiny convenience to pretty-print decision reasons in logs / rejection rows.
 */
export function explainDecision(cand: Candidate, judges: Judges, decision: Decision): string {
  const reasons: string[] = [];
  if (judges.j1 === null) reasons.push("j1 unavailable");
  if (judges.j2 === null) reasons.push("j2 unavailable");
  const fails = [
    ...(judges.j1?.field_verdicts.filter((v) => v.verdict === "FAIL") ?? []).map(
      (v) => `j1 FAIL ${v.field}`
    ),
    ...(judges.j2?.field_verdicts.filter((v) => v.verdict === "FAIL") ?? []).map(
      (v) => `j2 FAIL ${v.field}`
    ),
  ];
  if (fails.length) reasons.push(...fails);
  reasons.push(
    `auto_mode=${cand.auto_mode}`,
    `auto_conf=${cand.auto_confidence.toFixed(2)}`,
    `j1_pass=${judges.j1?.overall_pass ?? "?"}`,
    `j2_pass=${judges.j2?.overall_pass ?? "?"}`
  );
  return `${decision} :: ${reasons.join(" · ")}`;
}

// Re-export for driver convenience
export { LLMError };
