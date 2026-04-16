/**
 * Phase 4 — Normalize extracted gear to DB IDs.
 *
 * Master plan §5.1 + DATA-AUTOMATION §5.
 *
 * For each extracted (brand, model) tuple in {guitar, amp, pedals}:
 *   1. pg_trgm similarity search against the relevant gear table
 *   2. If top similarity ≥ 0.6, adopt that ID
 *   3. Otherwise, enqueue in gear_expansion_queue (for future DB growth)
 *      and fall back to free-text
 *
 * The result is attached to the Extraction as `.normalized`, preserving the
 * original LLM output for audit.
 */
import { db } from "@/lib/db/client";
import { amps, guitars, pedals as pedalsTable } from "@/lib/db/schema";
import { trackGearMiss } from "@/lib/db/queries";
import { desc, sql } from "drizzle-orm";
import type { Extraction } from "./schemas";

const MIN_MATCH = 0.6;
const SEARCH_THRESHOLD = 0.35;

export interface NormalizedGear {
  guitar: { id: number | null; freetext: string | null };
  amp: { id: number | null; freetext: string | null };
  pedals: Array<{
    id: number | null;
    freetext: string | null;
    category: string;
    source_indices: number[];
  }>;
}

export async function normalizeGear(ext: Extraction): Promise<NormalizedGear> {
  const [g, a, peds] = await Promise.all([
    resolveGuitar(ext.guitar.brand, ext.guitar.model),
    resolveAmp(ext.amp.brand, ext.amp.model),
    Promise.all(
      ext.pedals.map(async (p) => {
        const resolved = await resolvePedal(p.brand, p.model, p.category);
        return {
          id: resolved.id,
          freetext: resolved.freetext,
          category: p.category,
          source_indices: p.source_indices,
        };
      })
    ),
  ]);

  return { guitar: g, amp: a, pedals: peds };
}

// =============================================================================
// Per-kind resolvers
// =============================================================================

export async function resolveGuitar(
  brand: string | null,
  model: string | null
): Promise<{ id: number | null; freetext: string | null }> {
  if (!brand || !model) return { id: null, freetext: null };
  const q = `${brand} ${model}`;
  const rows = await db
    .select({
      id: guitars.id,
      similarity: sql<number>`similarity(${guitars.brand} || ' ' || ${guitars.model}, ${q})`,
    })
    .from(guitars)
    .where(sql`similarity(${guitars.brand} || ' ' || ${guitars.model}, ${q}) > ${SEARCH_THRESHOLD}`)
    .orderBy(desc(sql`similarity(${guitars.brand} || ' ' || ${guitars.model}, ${q})`))
    .limit(3);

  if (rows[0] && Number(rows[0].similarity) >= MIN_MATCH) {
    return { id: rows[0].id, freetext: null };
  }

  await trackGearMiss("guitar", brand, model);
  return { id: null, freetext: q };
}

export async function resolveAmp(
  brand: string | null,
  model: string | null
): Promise<{ id: number | null; freetext: string | null }> {
  if (!brand || !model) return { id: null, freetext: null };
  const q = `${brand} ${model}`;
  const rows = await db
    .select({
      id: amps.id,
      similarity: sql<number>`similarity(${amps.brand} || ' ' || ${amps.model}, ${q})`,
    })
    .from(amps)
    .where(sql`similarity(${amps.brand} || ' ' || ${amps.model}, ${q}) > ${SEARCH_THRESHOLD}`)
    .orderBy(desc(sql`similarity(${amps.brand} || ' ' || ${amps.model}, ${q})`))
    .limit(3);

  if (rows[0] && Number(rows[0].similarity) >= MIN_MATCH) {
    return { id: rows[0].id, freetext: null };
  }

  await trackGearMiss("amp", brand, model);
  return { id: null, freetext: q };
}

export async function resolvePedal(
  brand: string | null,
  model: string | null,
  category: string
): Promise<{ id: number | null; freetext: string | null }> {
  if (!brand || !model) {
    // No model info — we can't even queue a useful miss row. Record category only
    // so operators see category-level demand.
    await trackGearMiss("pedal", null, `${category} (unspecified)`);
    return { id: null, freetext: brand || model || `generic ${category}` };
  }
  const q = `${brand} ${model}`;
  const rows = await db
    .select({
      id: pedalsTable.id,
      similarity: sql<number>`similarity(${pedalsTable.brand} || ' ' || ${pedalsTable.model}, ${q})`,
    })
    .from(pedalsTable)
    .where(
      sql`similarity(${pedalsTable.brand} || ' ' || ${pedalsTable.model}, ${q}) > ${SEARCH_THRESHOLD}`
    )
    .orderBy(desc(sql`similarity(${pedalsTable.brand} || ' ' || ${pedalsTable.model}, ${q})`))
    .limit(3);

  if (rows[0] && Number(rows[0].similarity) >= MIN_MATCH) {
    return { id: rows[0].id, freetext: null };
  }

  await trackGearMiss("pedal", brand, model);
  return { id: null, freetext: q };
}
