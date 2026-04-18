/**
 * Generate LLM draft `knob_notes` for amps that lack them.
 *
 * Master plan §6.5.9.  `knob_notes` is free-text that describes each amp's
 * knob behaviour (e.g. "Mid is pre-EQ; cut below 4 scoops the midrange;
 * Presence interacts with the power tubes above 7").  It is injected into
 * Stage-2 adapt-tone prompts so the LLM can translate settings accurately
 * across amps with different EQ topologies.
 *
 * Human-in-the-loop by design: this script produces **drafts**. Writes a
 * patch file that the operator reviews (5 min × ~50 amps = 4 h, plan §6.6.5).
 * Use --apply after review to UPDATE amps.knob_notes.
 *
 * CLI:
 *   npm run seed:gen-knob-notes                     # draft all amps missing notes
 *   npm run seed:gen-knob-notes -- --force          # draft all amps (overwrite)
 *   npm run seed:gen-knob-notes -- --count=10       # draft at most 10
 *   npm run seed:gen-knob-notes -- --only=marshall  # filter brand/model substring
 *   npm run seed:gen-knob-notes -- --out=path       # patch file location
 *   npm run seed:gen-knob-notes -- --apply          # merge an existing patch file into DB
 *   npm run seed:gen-knob-notes -- --apply --in=path
 *
 * Output shape (patch file):
 *   [
 *     {
 *       "id": 42,
 *       "brand": "Marshall",
 *       "model": "JCM800",
 *       "current": null,
 *       "proposed": "…"
 *     }, …
 *   ]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { amps } from "@/lib/db/schema";
import { completeFromZod } from "@/lib/llm/provider";

const DEFAULT_PATCH_PATH = path.join(
  process.cwd(),
  "scripts/seed/data/knob_notes_patches.json"
);

const KNOB_NOTES_SYSTEM = `You are a guitar amplifier expert writing "knob_notes" — a short free-text
guide (2-4 sentences) explaining how each knob on this specific amp behaves.

Goals:
- Capture what makes THIS amp's EQ or gain structure distinctive vs a generic tube amp.
- Note interactions (e.g. "presence is tied to power stage", "gain/master interact").
- Avoid generic filler ("the gain knob controls distortion") — only write what is
  useful when translating settings between amps of different voicings.
- 60-180 words total. Plain prose, no bullet points or markdown.
- Do NOT invent facts about features the amp doesn't have. If unsure, err toward
  voicing-level description rather than specific component claims.`;

const KnobNotesSchema = z.object({
  notes: z.string().min(40).max(1200),
  reasoning_summary: z.string().max(200),
});

interface PatchRow {
  id: number;
  brand: string;
  model: string;
  current: string | null;
  proposed: string;
}

interface Args {
  force: boolean;
  count: number | null;
  only: string | null;
  outPath: string | null;
  apply: boolean;
  inPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    force: false,
    count: null,
    only: null,
    outPath: null,
    apply: false,
    inPath: null,
  };
  for (const a of argv.slice(2)) {
    if (a === "--force") args.force = true;
    else if (a === "--apply") args.apply = true;
    else if (a.startsWith("--count=")) {
      const n = Number(a.slice("--count=".length));
      if (Number.isFinite(n) && n > 0) args.count = n;
    } else if (a.startsWith("--only=")) args.only = a.slice("--only=".length);
    else if (a.startsWith("--out=")) args.outPath = a.slice("--out=".length);
    else if (a.startsWith("--in=")) args.inPath = a.slice("--in=".length);
    else if (a === "--help" || a === "-h") {
      console.log(`gen_knob_notes — draft amp knob_notes for operator review

Generate mode (default):
  --force            redraft all amps (overwrite existing notes in patch)
  --count=N          draft at most N amps
  --only=<substr>    filter by brand/model substring (case-insensitive)
  --out=<path>       patch file location

Apply mode:
  --apply            merge the patch file into amps.knob_notes (UPDATE ... WHERE id=)
  --in=<path>        patch file to read (default: out path)`);
      process.exit(0);
    }
  }
  return args;
}

async function selectAmps(args: Args) {
  const whereClauses = [];
  if (!args.force) whereClauses.push(isNull(amps.knobNotes));
  if (args.only) {
    const pattern = `%${args.only.toLowerCase()}%`;
    whereClauses.push(
      sql`(lower(${amps.brand}) LIKE ${pattern} OR lower(${amps.model}) LIKE ${pattern})`
    );
  }
  const rows = await db
    .select({
      id: amps.id,
      brand: amps.brand,
      model: amps.model,
      voicing: amps.voicing,
      characterTags: amps.characterTags,
      knobLayout: amps.knobLayout,
      watts: amps.watts,
      typicalGenres: amps.typicalGenres,
      knobNotes: amps.knobNotes,
    })
    .from(amps)
    .where(whereClauses.length ? and(...whereClauses) : undefined)
    .orderBy(amps.id);

  return args.count !== null ? rows.slice(0, args.count) : rows;
}

type AmpRow = Awaited<ReturnType<typeof selectAmps>>[number];

function buildUserMessage(amp: AmpRow): string {
  const lines = [
    `Amp: ${amp.brand} ${amp.model}`,
    amp.voicing ? `Voicing tag: ${amp.voicing}` : null,
    amp.watts ? `Watts: ${amp.watts}` : null,
    amp.typicalGenres?.length ? `Typical genres: ${amp.typicalGenres.join(", ")}` : null,
    amp.characterTags?.length ? `Character tags: ${amp.characterTags.join(", ")}` : null,
    amp.knobLayout
      ? `Knob layout (present controls): ${Object.entries(amp.knobLayout)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(", ")}`
      : null,
  ].filter(Boolean);
  return lines.join("\n");
}

async function generate(args: Args) {
  const rows = await selectAmps(args);
  if (rows.length === 0) {
    console.log("no amps to draft (all have knob_notes, or filter matched nothing).");
    return;
  }
  console.log(`▶ drafting knob_notes for ${rows.length} amps…`);

  const patches: PatchRow[] = [];
  let ok = 0;
  let err = 0;

  for (const amp of rows) {
    try {
      const res = await completeFromZod({
        provider: "gemini",
        system: KNOB_NOTES_SYSTEM,
        user: buildUserMessage(amp),
        schema: KnobNotesSchema,
        schemaName: "KnobNotes",
        temperature: 0.4,
        withFallback: true,
      });
      patches.push({
        id: amp.id,
        brand: amp.brand,
        model: amp.model,
        current: amp.knobNotes,
        proposed: res.data.notes.trim(),
      });
      ok++;
      console.log(`  ✓ ${amp.brand} ${amp.model}`);
    } catch (e) {
      err++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ✗ ${amp.brand} ${amp.model}: ${msg.slice(0, 120)}`);
    }
    // Pace to ~10 RPM to stay inside Gemini free tier with headroom.
    await new Promise((r) => setTimeout(r, 6_000));
  }

  const outPath = args.outPath ?? DEFAULT_PATCH_PATH;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(patches, null, 2) + "\n");
  console.log(`\n✅ wrote ${patches.length} drafts → ${path.relative(process.cwd(), outPath)}`);
  console.log(`   ok=${ok}  err=${err}`);
  console.log(`\nNext:`);
  console.log(`  1. open the patch file, review/edit each "proposed" string`);
  console.log(`  2. npm run seed:gen-knob-notes -- --apply`);
}

async function applyPatch(args: Args) {
  const inPath = args.inPath ?? args.outPath ?? DEFAULT_PATCH_PATH;
  if (!fs.existsSync(inPath)) {
    console.error(`❌ patch file not found: ${inPath}`);
    process.exit(1);
  }
  const patches = JSON.parse(fs.readFileSync(inPath, "utf-8")) as PatchRow[];
  if (!Array.isArray(patches) || patches.length === 0) {
    console.error(`❌ ${inPath}: empty or not an array`);
    process.exit(1);
  }

  let updated = 0;
  for (const p of patches) {
    if (!p.proposed || p.proposed.trim().length < 40) {
      console.warn(`skip id=${p.id} (${p.brand} ${p.model}) — proposed too short`);
      continue;
    }
    await db.update(amps).set({ knobNotes: p.proposed.trim() }).where(eq(amps.id, p.id));
    updated++;
  }
  console.log(`✅ applied ${updated}/${patches.length} knob_notes updates`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.apply) await applyPatch(args);
  else await generate(args);
}

main().catch((err) => {
  console.error("[gen-knob-notes] fatal:", err);
  process.exit(1);
});
