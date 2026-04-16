/**
 * Route middleware — auth gate only.
 *
 * Edge runtime, so we can't touch the Drizzle DB here. Onboarding gating
 * happens in app/(app)/layout.tsx (Server Component) where we have full DB access.
 *
 * Master plan §9.1.
 *
 * Behaviour:
 *   - Refreshes the Supabase session cookie on every request that hits
 *     a matched path so server components downstream see a valid user.
 *   - Redirects to /auth/signin when accessing protected routes without
 *     an authenticated session.
 *
 * Protected paths: /onboarding, /search, /result, /library, /app/**
 * Always-public: /, /pricing, /community/**, /auth/**, /api/**, /_next/**
 */
import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

const PROTECTED_PREFIXES = ["/onboarding", "/search", "/result", "/library"];

function isProtected(pathname: string): boolean {
  if (pathname.startsWith("/app/")) return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  // Forward original headers + propagate pathname for Server Components
  // that need to know the current route (e.g. (app)/layout's onboarding gate).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh Supabase session cookie. This ALSO populates getUser() for the
  // current request — important for downstream Server Components.
  const supa = createMiddlewareClient(req, res);
  const { data } = await supa.auth.getUser();

  if (isProtected(req.nextUrl.pathname) && !data.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("redirect", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Skip static assets, _next, favicon, and API routes (those auth-check themselves).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
