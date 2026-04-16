/**
 * GET /auth/callback?code=... [&redirect=/path]
 *
 * OAuth + email-magic-link callback. Exchanges the auth code for a session
 * cookie (set automatically by the SSR client) then redirects to either the
 * requested path or /onboarding (the default for first-time signups).
 *
 * The auth.users row is created by Supabase; the corresponding public.users
 * row is created by the on_auth_user_created trigger (0008). No manual
 * insert needed here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirect = req.nextUrl.searchParams.get("redirect") ?? "/onboarding";

  if (!code) {
    return NextResponse.redirect(new URL("/auth/signin?error=missing_code", req.nextUrl.origin));
  }

  const supa = await createClient();
  const { error } = await supa.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL("/auth/signin", req.nextUrl.origin);
    url.searchParams.set("error", error.message);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(redirect, req.nextUrl.origin));
}
