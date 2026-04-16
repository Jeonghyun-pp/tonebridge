/**
 * Layout for protected app routes (/onboarding, /search, /result, /library).
 *
 * Server Component — performs the onboarding gate via DB query that the
 * Edge middleware can't do. Middleware already guarantees the user is
 * authenticated, so we only need to check onboarding status here.
 *
 * The /onboarding route is allowed even when onboarding_complete=false —
 * otherwise the user couldn't complete onboarding.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import Link from "next/link";
import { CreditsDisplay } from "@/components/credits-display";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    // middleware should have already redirected, but defensive in case
    // /api/* somehow reach here.
    redirect("/auth/signin");
  }

  const path = (await headers()).get("x-pathname") ?? "";
  const isOnboarding = path.startsWith("/onboarding");

  if (!session.profile.onboardingComplete && !isOnboarding) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between">
        <Link href="/search" className="text-sm font-semibold tracking-tight">
          ToneBridge
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <CreditsDisplay />
          <Link href="/search" className="hover:underline">
            Search
          </Link>
          <Link href="/library" className="hover:underline">
            Library
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
