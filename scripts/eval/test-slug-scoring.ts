/**
 * Pure tests for slug + scoring — no API, no DB.
 *
 *   npx tsx scripts/eval/test-slug-scoring.ts
 */
import { toSlug, parseSlug } from "../../lib/community/slug";
import { scoreOne, shouldHalt, MAX_SCORE, THRESHOLD } from "../../lib/community/scoring";
import type { ReferenceTone } from "../../lib/db/schema";

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

function ref(p: Partial<Pick<ReferenceTone, "song" | "artist" | "section" | "toneType" | "instrument">>) {
  return {
    song: "Master of Puppets",
    artist: "Metallica",
    section: "riff" as const,
    toneType: "high_gain" as const,
    instrument: "guitar",
    ...p,
  };
}

// -----------------------------------------------------------------------------
console.log("slug");

test("round-trips a basic English song", () => {
  const slug = toSlug(ref({}));
  assertEq(slug, "master-of-puppets--metallica--riff--high_gain--guitar");
  const parsed = parseSlug(slug);
  assert(parsed !== null, "parsed should not be null");
  assert(parsed!.song.toLowerCase() === "master of puppets", `got ${parsed!.song}`);
  assert(parsed!.artist.toLowerCase() === "metallica", "");
});

test("handles apostrophes and slashes", () => {
  const slug = toSlug(ref({ song: "Sweet Child O' Mine", artist: "Guns N' Roses" }));
  assert(!slug.includes("'") && !slug.includes("’"), `slug should not contain apostrophes: ${slug}`);
  assert(slug.includes("sweet-child-o-mine"), `got: ${slug}`);
});

test("preserves Korean characters", () => {
  const slug = toSlug(ref({ song: "연", artist: "잠비나이" }));
  assert(slug.includes("연") && slug.includes("잠비나이"), `expected Korean preserved, got: ${slug}`);
});

test("treats null toneType as 'any'", () => {
  const slug = toSlug({ ...ref({}), toneType: null });
  assert(slug.includes("--any--"), `expected --any-- in: ${slug}`);
  const parsed = parseSlug(slug);
  assertEq(parsed!.toneType, null);
});

test("rejects malformed slug", () => {
  assertEq(parseSlug("only-three--parts--here"), null);
  assertEq(parseSlug(""), null);
});

test("rejects invalid section enum", () => {
  assertEq(parseSlug("song--artist--invalidsection--clean--guitar"), null);
});

// -----------------------------------------------------------------------------
console.log("scoring");

const expected = {
  settings: { gain: 7, bass: 5, mid: 5, treble: 6, presence: 6 },
  pedalCategories: ["overdrive"],
  confidenceMin: 0.6,
};

test("perfect match → 5.0", () => {
  const r = scoreOne(expected, {
    settings: expected.settings,
    pedalCategories: expected.pedalCategories,
    confidence: 0.7,
    playingTips: ["dial it in by ear"],
    adaptationNotes: "x".repeat(80),
  });
  assertEq(r.total, MAX_SCORE);
});

test("knob within ±2 still scores", () => {
  const r = scoreOne(expected, {
    settings: { gain: 5, bass: 5, mid: 5, treble: 6, presence: 6 },   // gain off by 2
    pedalCategories: expected.pedalCategories,
    confidence: 0.7,
    playingTips: ["x"],
    adaptationNotes: "x".repeat(80),
  });
  assertEq(r.knobs, 2.5);     // 5 × 0.5 — within tolerance
});

test("knob beyond ±2 loses that knob", () => {
  const r = scoreOne(expected, {
    settings: { gain: 1, bass: 5, mid: 5, treble: 6, presence: 6 },   // gain off by 6
    pedalCategories: expected.pedalCategories,
    confidence: 0.7,
    playingTips: ["x"],
    adaptationNotes: "x".repeat(80),
  });
  assertEq(r.knobs, 2.0);
});

test("missing pedal category zeroes pedals score", () => {
  const r = scoreOne(expected, {
    settings: expected.settings,
    pedalCategories: [],
    confidence: 0.7,
    playingTips: ["x"],
    adaptationNotes: "x".repeat(80),
  });
  assertEq(r.pedals, 0);
});

test("low confidence loses confidence point", () => {
  const r = scoreOne(expected, {
    settings: expected.settings,
    pedalCategories: expected.pedalCategories,
    confidence: 0.3,    // below floor of 0.6
    playingTips: ["x"],
    adaptationNotes: "x".repeat(80),
  });
  assertEq(r.confidence, 0);
});

test("empty notes loses notes point", () => {
  const r = scoreOne(expected, {
    settings: expected.settings,
    pedalCategories: expected.pedalCategories,
    confidence: 0.7,
    playingTips: ["x"],
    adaptationNotes: "short",
  });
  assertEq(r.notes, 0);
});

// -----------------------------------------------------------------------------
console.log("shouldHalt");

test("halt when 5+ of last 7 below threshold", () => {
  assertEq(shouldHalt([1, 2, 3, 3.0, 3.4, 3.5, 4]), true);  // 5 below 3.5
});

test("no halt when only 4 of 7 below threshold", () => {
  assertEq(shouldHalt([2, 3, 3.4, 3.4, 3.5, 4, 4]), false);
});

test("no halt with fewer than 7 runs even if all below threshold", () => {
  // 4 runs all below threshold = 4 < 5 → not halt
  assertEq(shouldHalt([1, 2, 3, 3.4]), false);
});

test("THRESHOLD constant is 3.5", () => {
  assertEq(THRESHOLD, 3.5);
});

console.log(failures === 0 ? "\n✅ all passed" : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
