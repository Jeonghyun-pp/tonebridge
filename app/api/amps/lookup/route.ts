/**
 * GET /api/amps/lookup?q=mesa&modelers=true|false&limit=20
 *
 * Public catalog autocomplete — used by onboarding step 3 and by
 * the future "edit my gear" flow. No auth required (read-only).
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { amps } from "@/lib/db/schema";
import { sql, desc, and, eq, or, ilike } from "drizzle-orm";
import { lookupLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const modelers = req.nextUrl.searchParams.get("modelers");
  const limitParam = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "20")));

  if (q.length < 2) return NextResponse.json({ items: [] });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
  const rl = await lookupLimit.limit(`amps:${ip}`);
  if (!rl.success) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const conditions = [
    or(
      sql`${amps.brand} || ' ' || ${amps.model} % ${q}`,    // pg_trgm "%" operator
      ilike(amps.brand, `%${q}%`),
      ilike(amps.model, `%${q}%`),
      sql`${q} ILIKE ANY(${amps.aliases})`
    ),
  ];
  if (modelers === "true") conditions.push(eq(amps.isModeler, true));
  if (modelers === "false") conditions.push(eq(amps.isModeler, false));

  const items = await db
    .select({
      id: amps.id,
      brand: amps.brand,
      model: amps.model,
      voicing: amps.voicing,
      isModeler: amps.isModeler,
      popularity: amps.popularity,
      similarity: sql<number>`similarity(${amps.brand} || ' ' || ${amps.model}, ${q})`,
    })
    .from(amps)
    .where(and(...conditions))
    .orderBy(
      desc(sql`similarity(${amps.brand} || ' ' || ${amps.model}, ${q})`),
      desc(amps.popularity)
    )
    .limit(limitParam);

  return NextResponse.json({ items });
}
