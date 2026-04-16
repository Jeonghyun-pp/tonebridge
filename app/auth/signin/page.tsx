"use client";

/**
 * Sign-in page — email magic link + Google OAuth.
 *
 * Master plan §9.1.
 *
 * Email magic link is the fastest path for a beta user (no password to
 * remember; no SMS cost). Google OAuth is one click for the >70% of guitar
 * forum users who already have a Google account.
 */
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/onboarding";
  const errorMsg = params.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(errorMsg);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorText(null);
    const supa = createClient();
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(
          redirect
        )}`,
      },
    });
    if (error) {
      setErrorText(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  async function signInWithGoogle() {
    const supa = createClient();
    await supa.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(
          redirect
        )}`,
      },
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-widest text-zinc-500 uppercase">
            ToneBridge
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            We&apos;ll send you a one-time link. No password.
          </p>
        </header>

        {errorText && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-900">
            {errorText}
          </div>
        )}

        <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@email.com"
            disabled={status === "sending" || status === "sent"}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={status === "sending" || status === "sent" || !email}
            className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === "sending"
              ? "Sending…"
              : status === "sent"
                ? "Check your email"
                : "Email me a sign-in link"}
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <hr className="flex-1 border-zinc-200 dark:border-zinc-800" />
          <span>or</span>
          <hr className="flex-1 border-zinc-200 dark:border-zinc-800" />
        </div>

        <button
          type="button"
          onClick={signInWithGoogle}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          Continue with Google
        </button>

        <p className="text-xs text-zinc-500 text-center">
          By continuing you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </main>
  );
}
