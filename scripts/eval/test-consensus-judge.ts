/**
 * Pure-function tests for Phase 3/5/6 — no API, no DB.
 *
 *   npx tsx scripts/eval/test-consensus-judge.ts
 */
import {
  mergeByMajority,
  majorityOrNull,
  avgIntOrNull,
  unionSourceIndices,
} from "../../lib/automation/phase3-multi-llm";
import {
  countTiers,
  decideMode,
  scoreTone,
  modeBaseline,
  modeCeiling,
} from "../../lib/automation/phase5-score";
import {
  decideDualJudge,
  type Candidate,
  type Judges,
} from "../../lib/automation/phase6-dual-judge";
import type { Extraction, SearchResult, JudgeResult } from "../../lib/automation/schemas";

let failures = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(a: T, b: T, label?: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label ?? "assertEq"}  actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}`);
  }
}

// -----------------------------------------------------------------------------
// majorityOrNull / avgIntOrNull / unionSourceIndices
// -----------------------------------------------------------------------------
console.log("phase3 primitives");

test("majorityOrNull: 2/3 agree keeps value", () => {
  const m = majorityOrNull(["Gibson", "Gibson", "Fender"], 3);
  assertEq(m.value, "Gibson");
  assert(m.agreementFraction > 0.6, `frac=${m.agreementFraction}`);
});

test("majorityOrNull: 1/3 drops to null", () => {
  const m = majorityOrNull(["A", "B", "C"], 3);
  assertEq(m.value, null);
});

test("majorityOrNull: null majority stays null", () => {
  const m = majorityOrNull([null, null, "Gibson"], 3);
  assertEq(m.value, null);
});

test("majorityOrNull: n=2 requires both agree", () => {
  assertEq(majorityOrNull(["X", "X"], 2).value, "X");
  assertEq(majorityOrNull(["X", "Y"], 2).value, null);
});

test("avgIntOrNull: close values average", () => {
  assertEq(avgIntOrNull([7, 8]), 8);    // rounds to 8
  assertEq(avgIntOrNull([5, 6, 7]), 6);
});

test("avgIntOrNull: spread > 2 returns null", () => {
  assertEq(avgIntOrNull([3, 8]), null);
});

test("avgIntOrNull: <2 non-null returns null", () => {
  assertEq(avgIntOrNull([5, null, null]), null);
  assertEq(avgIntOrNull([null, null]), null);
});

test("unionSourceIndices: dedupes and sorts", () => {
  assertEq(unionSourceIndices([[0, 2], [1, 2], [0, 3]]), [0, 1, 2, 3]);
});

// -----------------------------------------------------------------------------
// mergeByMajority — end-to-end on a small example
// -----------------------------------------------------------------------------
console.log("mergeByMajority");

function makeExtraction(override: Partial<Extraction>): Extraction {
  const base: Extraction = {
    song: "Master of Puppets",
    artist: "Metallica",
    guitar: {
      brand: "ESP",
      model: "Explorer Custom",
      pickup_config: "HH",
      year: 1986,
      source_indices: [0],
      confidence: 0.8,
    },
    amp: {
      brand: "Mesa/Boogie",
      model: "Mark IV",
      source_indices: [0, 1],
      confidence: 0.8,
    },
    pedals: [
      {
        category: "overdrive",
        brand: "Ibanez",
        model: "TS9",
        position_in_chain: 1,
        purpose: "tighten low end",
        source_indices: [1],
        confidence: 0.75,
      },
    ],
    settings: {
      gain: 7,
      bass: 5,
      mid: 5,
      treble: 6,
      presence: 6,
      reverb: 0,
      source_indices: [0],
      inferred: false,
    },
    pickup_choice: { value: "Bridge", source_indices: [0], confidence: 0.8 },
    tone_characteristics: ["heavy", "tight"],
    extraction_notes: "High-gain metal rhythm tone.",
    overall_confidence: 0.85,
  };
  return { ...base, ...override };
}

test("merges three identical runs losslessly", () => {
  const a = makeExtraction({});
  const { extraction, consensus_score } = mergeByMajority([a, a, a], { song: a.song, artist: a.artist });
  assertEq(extraction.guitar.model, "Explorer Custom");
  assertEq(extraction.amp.model, "Mark IV");
  assertEq(extraction.pedals.length, 1);
  assert(consensus_score > 0.99, `full agreement should be ~1, got ${consensus_score}`);
});

test("drops a scalar when only 1/3 agrees", () => {
  const a = makeExtraction({});
  const b = makeExtraction({
    guitar: { ...a.guitar, model: "KH-2", brand: "ESP" },
  });
  const c = makeExtraction({
    guitar: { ...a.guitar, model: "Telecaster", brand: "Fender" },
  });
  const { extraction } = mergeByMajority([a, b, c], { song: a.song, artist: a.artist });
  // brand: ESP twice, Fender once → ESP wins
  assertEq(extraction.guitar.brand, "ESP");
  // model: all three different → null
  assertEq(extraction.guitar.model, null);
});

test("pedals drop when only 1 run reports them", () => {
  const a = makeExtraction({});
  const b = makeExtraction({ pedals: [] });
  const c = makeExtraction({ pedals: [] });
  const { extraction } = mergeByMajority([a, b, c], { song: a.song, artist: a.artist });
  assertEq(extraction.pedals.length, 0);
});

test("pedals kept when ≥2 runs report matching key", () => {
  const a = makeExtraction({});
  const b = makeExtraction({});
  const c = makeExtraction({ pedals: [] });
  const { extraction } = mergeByMajority([a, b, c], { song: a.song, artist: a.artist });
  assertEq(extraction.pedals.length, 1);
});

test("settings collapse to null when spread > 2", () => {
  const a = makeExtraction({});
  const b = makeExtraction({
    settings: { ...a.settings!, gain: 2 },
  });
  const { extraction } = mergeByMajority([a, b], { song: a.song, artist: a.artist });
  // gain spread 7-2=5 > 2 → null
  assertEq(extraction.settings?.gain, null);
});

// -----------------------------------------------------------------------------
// phase5 scoring
// -----------------------------------------------------------------------------
console.log("phase5 scoring");

function sr(tier: 1 | 2 | 3): SearchResult {
  return { url: "https://x.example", title: "t", snippet: "s", tier };
}

test("countTiers basic", () => {
  assertEq(countTiers([sr(1), sr(1), sr(2), sr(3)]), { t1: 2, t2: 1, t3: 1 });
});

test("decideMode: ≥2 T1 → authoritative", () => {
  assertEq(decideMode({ t1: 2, t2: 0, t3: 0 }), "authoritative");
});

test("decideMode: 1 T1 + 1 T2 → authoritative", () => {
  assertEq(decideMode({ t1: 1, t2: 1, t3: 0 }), "authoritative");
});

test("decideMode: only T2 → inferred", () => {
  assertEq(decideMode({ t1: 0, t2: 3, t3: 0 }), "inferred");
});

test("decideMode: only T3 → speculative", () => {
  assertEq(decideMode({ t1: 0, t2: 0, t3: 2 }), "speculative");
});

test("scoreTone: authoritative baseline floor", () => {
  const ext = makeExtraction({ overall_confidence: 0.3 });
  // low field scores can't drop us below 0.7 when tier says authoritative
  const out = scoreTone(ext, [sr(1), sr(1), sr(2)]);
  assertEq(out.mode, "authoritative");
  assert(out.confidence >= modeBaseline("authoritative"), `conf=${out.confidence}`);
});

test("scoreTone: speculative caps at 0.4", () => {
  const ext = makeExtraction({});
  const out = scoreTone(ext, [sr(3)]);
  assertEq(out.mode, "speculative");
  assert(out.confidence <= modeCeiling("speculative"), `conf=${out.confidence}`);
});

// -----------------------------------------------------------------------------
// phase6 dual-judge decision (pure function)
// -----------------------------------------------------------------------------
console.log("decideDualJudge");

function candWithMode(mode: "authoritative" | "inferred" | "speculative", conf: number): Candidate {
  return {
    song: "s",
    artist: "a",
    extraction: makeExtraction({}),
    sources: [sr(1)],
    auto_mode: mode,
    auto_confidence: conf,
  };
}

function judge(overall_pass: boolean, mode: "authoritative" | "inferred" | "speculative", fails = 0): JudgeResult {
  const field_verdicts: JudgeResult["field_verdicts"] = [];
  for (let i = 0; i < fails; i++) {
    field_verdicts.push({ field: `f${i}`, verdict: "FAIL", reason: "" });
  }
  field_verdicts.push({ field: "ok", verdict: "PASS", reason: "" });
  return { overall_pass, field_verdicts, suggested_mode: mode, suggested_confidence: 0.8 };
}

test("both judges pass + both authoritative + auto_conf 0.8 → approve_authoritative", () => {
  const j: Judges = { j1: judge(true, "authoritative"), j2: judge(true, "authoritative") };
  assertEq(decideDualJudge(candWithMode("authoritative", 0.8), j), "approve_authoritative");
});

test("any single FAIL blocks authoritative", () => {
  const j: Judges = {
    j1: judge(true, "authoritative", 1),      // one FAIL verdict
    j2: judge(true, "authoritative"),
  };
  assertEq(decideDualJudge(candWithMode("authoritative", 0.9), j), "reject");
});

test("one judge passes → approve_inferred", () => {
  const j: Judges = {
    j1: judge(true, "inferred"),
    j2: judge(false, "inferred"),
  };
  assertEq(decideDualJudge(candWithMode("inferred", 0.5), j), "approve_inferred");
});

test("missing j2 + j1 pass → still approve_inferred if no FAIL", () => {
  const j: Judges = { j1: judge(true, "inferred"), j2: null };
  assertEq(decideDualJudge(candWithMode("inferred", 0.5), j), "approve_inferred");
});

test("both judges missing → reject", () => {
  const j: Judges = { j1: null, j2: null };
  assertEq(decideDualJudge(candWithMode("inferred", 0.8), j), "reject");
});

test("auto_confidence below 0.4 → reject even if both pass", () => {
  const j: Judges = { j1: judge(true, "inferred"), j2: judge(true, "inferred") };
  assertEq(decideDualJudge(candWithMode("inferred", 0.3), j), "reject");
});

// -----------------------------------------------------------------------------
console.log(failures === 0 ? "\n✅ all passed" : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
