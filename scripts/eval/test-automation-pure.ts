/**
 * Pure-function tests for automation modules — no API keys, no network.
 *
 *   npx tsx scripts/eval/test-automation-pure.ts
 */
import { stripHtml, extractSection } from "../../lib/automation/fetch-guard";
import { classifyTier, isAllowedDomain, buildQueries } from "../../lib/automation/phase2-brave";

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
// stripHtml
// -----------------------------------------------------------------------------
console.log("stripHtml");

test("drops tags and entities", () => {
  const out = stripHtml("<p>Hello &amp; <b>world</b></p>");
  assertEq(out, "Hello & world");
});

test("drops script/style content", () => {
  const out = stripHtml("<p>A</p><script>var x = 1;</script><style>p{}</style><p>B</p>");
  assertEq(out, "A B");
});

test("collapses whitespace", () => {
  const out = stripHtml("<p>A</p>\n\n\n   \n<p>B</p>");
  assertEq(out, "A B");
});

// -----------------------------------------------------------------------------
// extractSection (Wikipedia Parsoid-style HTML)
// -----------------------------------------------------------------------------
console.log("extractSection");

test("pulls Equipment section until next h2", () => {
  const html = `
    <section data-mw-section-id="0"><p>Lead paragraph</p></section>
    <section data-mw-section-id="3">
      <h2 id="Equipment">Equipment</h2>
      <p>Kirk Hammett uses an ESP KH-2 and a Mesa Mark IV.</p>
    </section>
    <section data-mw-section-id="4">
      <h2 id="Discography">Discography</h2>
      <p>Albums list...</p>
    </section>
  `;
  const out = extractSection(html, "Equipment");
  assert(out !== null, "section should be found");
  assert(out!.includes("ESP KH-2"), `must contain gear fact, got: ${out}`);
  assert(!out!.includes("Albums list"), "must not bleed into next section");
});

test("tries lowercase and underscored variants", () => {
  const html = `<h2 id="equipment_and_gear">Equipment and gear</h2><p>xyz details</p>`;
  const out = extractSection(html, "Equipment and gear");
  assert(out !== null && out.includes("xyz details"), `got ${out}`);
});

test("returns null when section absent", () => {
  const html = `<h2 id="History">History</h2><p>Some history</p>`;
  const out = extractSection(html, "Equipment");
  assertEq(out, null);
});

// -----------------------------------------------------------------------------
// Brave whitelist classification
// -----------------------------------------------------------------------------
console.log("whitelist / classifyTier");

test("Tier 1 for Premier Guitar", () => {
  assertEq(classifyTier("https://www.premierguitar.com/artists/kirk-hammett"), 1);
});

test("Tier 1 for manufacturer domain", () => {
  assertEq(classifyTier("https://fender.com/artists/rory-gallagher"), 1);
});

test("Tier 2 for Wikipedia", () => {
  assertEq(classifyTier("https://en.wikipedia.org/wiki/Master_of_Puppets"), 2);
});

test("Tier 2 for Equipboard", () => {
  assertEq(classifyTier("https://equipboard.com/pros/slash"), 2);
});

test("Tier 3 for Reddit", () => {
  assertEq(classifyTier("https://www.reddit.com/r/guitar/comments/xyz"), 3);
});

test("null for non-whitelisted (e.g. spammy SEO blogs)", () => {
  assertEq(classifyTier("https://random-guitar-blog.example/post"), null);
});

test("subdomain matches parent", () => {
  assertEq(classifyTier("https://shop.fender.com/en/guitars"), 1);
});

test("isAllowedDomain agrees with classifyTier", () => {
  assertEq(isAllowedDomain("https://www.premierguitar.com/x"), true);
  assertEq(isAllowedDomain("https://random-blog.example/x"), false);
});

// -----------------------------------------------------------------------------
// Brave query building
// -----------------------------------------------------------------------------
console.log("buildQueries");

test("generates two queries with song + artist embedded", () => {
  const qs = buildQueries("Master of Puppets", "Metallica");
  assertEq(qs.length, 2);
  assert(qs[0].includes("Metallica") && qs[0].includes("Master of Puppets"), "query 1 has both");
  assert(qs[1].includes("Metallica"), "query 2 has artist");
});

// -----------------------------------------------------------------------------
console.log(failures === 0 ? "\n✅ all passed" : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
