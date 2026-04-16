/**
 * GET /api/pedals/search?q=tube+screamer&category=overdrive&limit=20
 *
 * Public catalog search for pedals. Optional category filter narrows by
 * pedal type (overdrive | distortion | delay | reverb | wah | ...).
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { pedals } from "@/lib/db/schema";
import { sql, desc, and, eq, or, ilike } from "drizzle-orm";
import { lookupLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const category = req.nextUrl.searchParams.get("category")?.trim();
  const limitParam = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "20")));
  if (q.length < 2 && !category) return NextResponse.json({ items: [] });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
  const rl = await lookupLimit.limit(`pedals:${ip}`);
  if (!rl.success) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const conditions = [];
  if (q.length >= 2) {
    conditions.push(
      or(
        sql`${pedals.brand} || ' ' || ${pedals.model} % ${q}`,
        ilike(pedals.brand, `%${q}%`),
        ilike(pedals.model, `%${q}%`),
        sql`${q} ILIKE ANY(${pedals.aliases})`
      )
    );
  }
  if (category) conditions.push(eq(pedals.category, category));

  const items = await db
    .select({
      id: pedals.id,
      brand: pedals.brand,
      model: pedals.model,
      category: pedals.category,
      subcategory: pedals.subcategory,
      popularity: pedals.popularity,
      similarity: q.length >= 2
        ? sql<number>`similarity(${pedals.brand} || ' ' || ${pedals.model}, ${q})`
        : sql<number>`0`,
    })
    .from(pedals)
    .where(and(...conditions))
    .orderBy(
      desc(
        q.length >= 2
          ? sql`similarity(${pedals.brand} || ' ' || ${pedals.model}, ${q})`
          : sql`${pedals.popularity}`
      ),
      desc(pedals.popularity)
    )
    .limit(limitParam);

  return NextResponse.json({ items });
}
