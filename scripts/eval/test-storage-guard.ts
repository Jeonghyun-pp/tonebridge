/**
 * Storage-guard tests — no API, no DB.
 *
 *   npx tsx scripts/eval/test-storage-guard.ts
 */
import { assertNoRawContent } from "../../lib/automation/storage-guard";

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
function assertThrows(fn: () => void, msgIncludes: string) {
  try {
    fn();
    throw new Error(`expected throw containing "${msgIncludes}"`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(msgIncludes)) throw new Error(`got "${msg}"`);
  }
}

console.log("storage-guard");

test("accepts a well-formed reference_tones row", () => {
  assertNoRawContent({
    song: "Master of Puppets",
    artist: "Metallica",
    reference_settings: { gain: 7, bass: 5, mid: 5 },
    sources: ["https://example.com/1"],
    confidence: "0.85",
    mode: "authoritative",
    extraction_notes: "ok",
  });
});

test("rejects a field named html", () => {
  assertThrows(() => {
    assertNoRawContent({ ok: true, html: "<p>copied article</p>" });
  }, `forbidden field "$.html"`);
});

test("rejects raw_text nested", () => {
  assertThrows(() => {
    assertNoRawContent({
      sources: [{ url: "https://x", raw_text: "copied content here" }],
    });
  }, 'forbidden field "$.sources[0].raw_text"');
});

test("rejects an unexpectedly long string (likely leak)", () => {
  const leak = "x".repeat(600);
  assertThrows(() => {
    assertNoRawContent({ description: leak });
  }, "suspiciously long string");
});

test("allowlist: long extraction_notes is fine", () => {
  assertNoRawContent({ extraction_notes: "x".repeat(600) });
});

test("allowlist: long knob_notes is fine (gear DB)", () => {
  assertNoRawContent({ knob_notes: "x".repeat(2000) });
});

test("null / undefined / Date pass through", () => {
  assertNoRawContent({ a: null, b: undefined, c: new Date() });
});

console.log(failures === 0 ? "\n✅ all passed" : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
