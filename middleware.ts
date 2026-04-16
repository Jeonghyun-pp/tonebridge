/**
 * Route middleware — placeholder for S11 (master plan §9.1).
 * Will guard /app/**, /onboarding, /search, /result, /library
 * and force onboarding completion before app access.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
