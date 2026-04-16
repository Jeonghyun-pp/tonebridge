/**
 * POST /auth/signout
 *
 * Clears the Supabase session cookie and redirects to /.
 * POST-only so a phished link can't trigger an unwanted signout.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supa = await createClient();
  await supa.auth.signOut();
  return NextResponse.redirect(new URL("/", req.nextUrl.origin), 303);
}
