/**
 * GET /api/guitars/lookup?q=strat&limit=20
 *
 * Public catalog autocomplete for the onboarding guitar step.
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { guitars } from "@/lib/db/schema";
import { sql, desc, or, ilike } from "drizzle-orm";
import { lookupLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limitParam = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "20")));
  if (q.length < 2) return NextResponse.json({ items: [] });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anon";
  const rl = await lookupLimit.limit(`guitars:${ip}`);
  if (!rl.success) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const items = await db
    .select({
      id: guitars.id,
      brand: guitars.brand,
      model: guitars.model,
      pickupConfig: guitars.pickupConfig,
      pickupOutputMv: guitars.pickupOutputMv,
      popularity: guitars.popularity,
      similarity: sql<number>`similarity(${guitars.brand} || ' ' || ${guitars.model}, ${q})`,
    })
    .from(guitars)
    .where(
      or(
        sql`${guitars.brand} || ' ' || ${guitars.model} % ${q}`,
        ilike(guitars.brand, `%${q}%`),
        ilike(guitars.model, `%${q}%`),
        sql`${q} ILIKE ANY(${guitars.aliases})`
      )
    )
    .orderBy(
      desc(sql`similarity(${guitars.brand} || ' ' || ${guitars.model}, ${q})`),
      desc(guitars.popularity)
    )
    .limit(limitParam);

  return NextResponse.json({ items });
}
