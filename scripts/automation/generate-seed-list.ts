/**
 * Generate Tier A / Pilot / Tier B seed JSON from a human-curated plain-text list.
 *
 * Why a .txt file, not a JSON array:
 *   Song curation is a human task (master plan §6.6.5 item 1).  Using a plain
 *   text file keeps the team member's job to the minimum viable input —
 *   `Song | Artist` per line — while the pipeline-consumable JSON shape lives
 *   behind this script.  Every other field (section, toneType, genre) is
 *   auto-derived or left null so the extraction pipeline can choose based on
 *   sources rather than being pre-constrained by the curator.
 *
 * Inputs (team-maintained):
 *   scripts/seed/data/tier_a_songs.txt          — the curated Tier A list
 *   scripts/seed/data/tier_b_songs.txt          — (optional) Tier B list
 *
 * Outputs (pipeline-consumed):
 *   scripts/seed/data/tier_a_seeds.json         — full Tier A
 *   scripts/seed/data/tier_a_pilot_seeds.json   — pilot subset
 *   scripts/seed/data/tier_b_seeds.json         — Tier B
 *
 * CLI:
 *   npm run seed:tier-a-list                    # parse tier_a_songs.txt → tier_a_seeds.json
 *   npm run seed:tier-a-list -- --pilot         # pilot subset (first 20 by default)
 *   npm run seed:tier-a-list -- --pilot=30      # pilot with N=30
 *   npm run seed:tier-a-list -- --count=50      # first 50 only
 *   npm run seed:tier-a-list -- --tier-b        # parse tier_b_songs.txt → tier_b_seeds.json
 *   npm run seed:tier-a-list -- --input=path    # override input
 *   npm run seed:tier-a-list -- --out=path      # override output
 *
 * Text file syntax:
 *   `Song | Artist`                 one entry
 *   `Song | Artist  [pilot]`        force-include in pilot set
 *   `# comment` / blank             ignored
 */
import fs from "node:fs";
import path from "node:path";

// =============================================================================
// Seed shape expected by run-tier-a-zero-human.ts
// =============================================================================
interface Seed {
  song: string;
  artist: string;
  /** Default "riff" — pipeline overrides when sources imply a different section. */
  section: "riff";
}

interface ParsedEntry {
  song: string;
  artist: string;
  pilotFlag: boolean;
  line: number;
}

// =============================================================================
// Parser
// =============================================================================
const PILOT_TAG = /\[pilot\]/i;

export function parseSongList(raw: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  lines.forEach((originalLine, idx) => {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) return;

    const pilotFlag = PILOT_TAG.test(line);
    const cleaned = line.replace(PILOT_TAG, "").trim();

    const pipeIdx = cleaned.indexOf("|");
    if (pipeIdx === -1) {
      throw new Error(
        `[parse] line ${idx + 1}: missing '|' separator. Expected "Song | Artist".\n  → ${originalLine}`
      );
    }
    const song = cleaned.slice(0, pipeIdx).trim();
    const artist = cleaned.slice(pipeIdx + 1).trim();

    if (!song || !artist) {
      throw new Error(
        `[parse] line ${idx + 1}: empty song or artist. Expected "Song | Artist".\n  → ${originalLine}`
      );
    }

    const dedupeKey = `${song.toLowerCase()}::${artist.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      console.warn(`[parse] line ${idx + 1}: duplicate skipped — ${song} | ${artist}`);
      return;
    }
    seen.add(dedupeKey);
    entries.push({ song, artist, pilotFlag, line: idx + 1 });
  });

  return entries;
}

function toSeed(entry: ParsedEntry): Seed {
  return { song: entry.song, artist: entry.artist, section: "riff" };
}

// =============================================================================
// CLI
// =============================================================================
interface Args {
  pilot: boolean;
  pilotN: number;
  tierB: boolean;
  count: number | null;
  inputPath: string | null;
  outPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    pilot: false,
    pilotN: 20,
    tierB: false,
    count: null,
    inputPath: null,
    outPath: null,
  };
  for (const a of argv.slice(2)) {
    if (a === "--pilot") args.pilot = true;
    else if (a.startsWith("--pilot=")) {
      args.pilot = true;
      const n = Number(a.slice("--pilot=".length));
      if (Number.isFinite(n) && n > 0) args.pilotN = n;
    } else if (a === "--tier-b") args.tierB = true;
    else if (a.startsWith("--count=")) {
      const n = Number(a.slice("--count=".length));
      if (Number.isFinite(n) && n > 0) args.count = n;
    } else if (a.startsWith("--input=")) args.inputPath = a.slice("--input=".length);
    else if (a.startsWith("--out=")) args.outPath = a.slice("--out=".length);
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.warn(`[args] ignoring unknown flag: ${a}`);
    }
  }
  return args;
}

function defaultInputPath(args: Args): string {
  const dir = path.join(process.cwd(), "scripts/seed/data");
  return args.tierB
    ? path.join(dir, "tier_b_songs.txt")
    : path.join(dir, "tier_a_songs.txt");
}

function defaultOutPath(args: Args): string {
  const dir = path.join(process.cwd(), "scripts/seed/data");
  if (args.tierB) return path.join(dir, "tier_b_seeds.json");
  if (args.pilot) return path.join(dir, "tier_a_pilot_seeds.json");
  return path.join(dir, "tier_a_seeds.json");
}

function printHelp(): void {
  console.log(`generate-seed-list — parse plain-text song list into pipeline-ready JSON

Flags:
  --pilot[=N]       emit pilot subset (default N=20). Uses [pilot]-tagged songs first,
                    then fills to N with the head of the list.
  --count=N         emit first N songs only.
  --tier-b          target Tier B input (tier_b_songs.txt) → tier_b_seeds.json.
  --input=<path>    override input path.
  --out=<path>      override output path.
  --help, -h        show this help.`);
}

function selectPilot(entries: ParsedEntry[], n: number): ParsedEntry[] {
  const flagged = entries.filter((e) => e.pilotFlag);
  if (flagged.length >= n) return flagged.slice(0, n);
  const rest = entries.filter((e) => !e.pilotFlag);
  return [...flagged, ...rest].slice(0, n);
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = args.inputPath ?? defaultInputPath(args);
  const outPath = args.outPath ?? defaultOutPath(args);

  if (!fs.existsSync(inputPath)) {
    const examplePath = path.join(
      path.dirname(inputPath),
      args.tierB ? "tier_b_songs.example.txt" : "tier_a_songs.example.txt"
    );
    console.error(
      `❌ Input file not found: ${path.relative(process.cwd(), inputPath)}\n` +
        (fs.existsSync(examplePath)
          ? `   Template available: ${path.relative(process.cwd(), examplePath)}\n` +
            `   Copy it, add your songs, then re-run.`
          : `   Create this file with one "Song | Artist" entry per line.`)
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  const entries = parseSongList(raw);

  if (entries.length === 0) {
    console.error(`❌ No valid entries found in ${inputPath}. Add songs (Song | Artist) then re-run.`);
    process.exit(1);
  }

  let selection: ParsedEntry[];
  if (args.pilot) {
    selection = selectPilot(entries, args.pilotN);
  } else if (args.count !== null) {
    selection = entries.slice(0, args.count);
  } else {
    selection = entries;
  }

  const seeds = selection.map(toSeed);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(seeds, null, 2) + "\n");

  console.log(`✅ wrote ${seeds.length} seeds → ${path.relative(process.cwd(), outPath)}`);
  console.log(`   source: ${path.relative(process.cwd(), inputPath)} (${entries.length} valid entries)`);
  if (args.pilot) {
    const flaggedCount = selection.filter((e) => e.pilotFlag).length;
    console.log(`   pilot: ${flaggedCount} [pilot]-tagged + ${selection.length - flaggedCount} filled from top`);
  }
}

// Only run main when invoked as a script, not when imported (keeps tests possible).
if (typeof require !== "undefined" && require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
