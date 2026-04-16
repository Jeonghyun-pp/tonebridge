/**
 * Shared DB query helpers used across automation scripts and API routes.
 *
 * Import from this file rather than re-implementing the same logic in each
 * pipeline phase. Keeps the SQL surface area visible and auditable.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  evalHistory,
  gearExpansionQueue,
  referenceTones,
  rejectionLog,
  systemFlags,
  toneCandidates,
  type NewReferenceTone,
  type NewToneCandidate,
} from "./schema";

// =============================================================================
// Zero-Human pipeline guardrails
// =============================================================================

/**
 * Throws if the nightly eval guardrail has halted auto-insertion.
 * Called at the top of every data-pipeline script to ensure a
 * quality regression halts new writes until an operator intervenes.
 */
export async function checkHaltFlag(): Promise<void> {
  const rows = await db
    .select()
    .from(systemFlags)
    .where(eq(systemFlags.key, "auto_insertion_halted"))
    .limit(1);
  if (rows[0]?.value === "true") {
    throw new Error(
      `Auto-insertion halted by eval guardrail (reason: ${rows[0].reason ?? "unknown"}). ` +
        `Clear via: UPDATE system_flags SET value='false' WHERE key='auto_insertion_halted';`
    );
  }
}

export async function setHaltFlag(reason: string): Promise<void> {
  await db
    .insert(systemFlags)
    .values({ key: "auto_insertion_halted", value: "true", reason })
    .onConflictDoUpdate({
      target: systemFlags.key,
      set: { value: "true", reason, updatedAt: new Date() },
    });
}

export async function clearHaltFlag(): Promise<void> {
  await db
    .insert(systemFlags)
    .values({ key: "auto_insertion_halted", value: "false" })
    .onConflictDoUpdate({
      target: systemFlags.key,
      set: { value: "false", updatedAt: new Date() },
    });
}

// =============================================================================
// Reference tones insert / candidate queue
// =============================================================================

export async function insertReferenceTone(row: NewReferenceTone): Promise<number> {
  const [inserted] = await db
    .insert(referenceTones)
    .values(row)
    .onConflictDoUpdate({
      target: [
        referenceTones.song,
        referenceTones.artist,
        referenceTones.section,
        referenceTones.toneType,
        referenceTones.instrument,
      ],
      set: {
        referenceSettings: row.referenceSettings,
        guitarKnobSettings: row.guitarKnobSettings,
        referencePedals: row.referencePedals,
        sources: row.sources,
        confidence: row.confidence,
        mode: row.mode,
        updatedAt: new Date(),
      },
    })
    .returning({ id: referenceTones.id });
  return inserted.id;
}

export async function insertCandidate(row: NewToneCandidate): Promise<number> {
  const [inserted] = await db
    .insert(toneCandidates)
    .values(row)
    .returning({ id: toneCandidates.id });
  return inserted.id;
}

// =============================================================================
// Rejection log (Zero-Human Track)
// =============================================================================

export async function logRejection(row: {
  song: string;
  artist: string;
  section?: "intro" | "verse" | "chorus" | "riff" | "solo" | "bridge" | "outro" | "clean_intro";
  reason: string;
  extraction?: unknown;
  sources?: unknown;
  judges?: unknown;
  fallbackAction?: string;
}): Promise<void> {
  await db.insert(rejectionLog).values({
    song: row.song,
    artist: row.artist,
    section: row.section,
    reason: row.reason,
    extraction: row.extraction as any,
    sources: row.sources as any,
    judges: row.judges as any,
    fallbackAction: row.fallbackAction,
  });
}

// =============================================================================
// Gear expansion queue
// =============================================================================

export async function trackGearMiss(
  kind: "guitar" | "amp" | "pedal",
  brand: string | null,
  model: string | null
): Promise<void> {
  if (!brand && !model) return;
  await db
    .insert(gearExpansionQueue)
    .values({ kind, brand, model, hitCount: 1 })
    .onConflictDoUpdate({
      target: [gearExpansionQueue.kind, gearExpansionQueue.brand, gearExpansionQueue.model],
      set: { hitCount: sql`${gearExpansionQueue.hitCount} + 1` },
    });
}

// =============================================================================
// Eval history (nightly guardrail)
// =============================================================================

export async function recordEvalRun(args: {
  avgScore: number;
  results: unknown;
  modelPrimary?: string;
  haltedAfter?: boolean;
}): Promise<void> {
  await db.insert(evalHistory).values({
    avgScore: args.avgScore.toFixed(2),
    results: args.results as any,
    modelPrimary: args.modelPrimary,
    haltedAfter: args.haltedAfter ?? false,
  });
}

export async function recentEvalScores(limit = 7): Promise<number[]> {
  const rows = await db
    .select({ avgScore: evalHistory.avgScore })
    .from(evalHistory)
    .orderBy(desc(evalHistory.runAt))
    .limit(limit);
  return rows.map((r) => Number(r.avgScore));
}

// =============================================================================
// Reference tone lookups (used by /api/research-tone Tier A cache hit)
// =============================================================================

export async function findReferenceTone(opts: {
  song: string;
  artist: string;
  section: "intro" | "verse" | "chorus" | "riff" | "solo" | "bridge" | "outro" | "clean_intro";
}) {
  const rows = await db
    .select()
    .from(referenceTones)
    .where(
      and(
        sql`lower(${referenceTones.song}) = lower(${opts.song})`,
        sql`lower(${referenceTones.artist}) = lower(${opts.artist})`,
        eq(referenceTones.section, opts.section)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
