export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
            ToneBridge · pre-launch
          </span>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            Your gear, any guitar tone.
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Onboard your guitar and amp once. Search any song. Get amp settings,
            pedal chain, pickup choice, and playing tips translated to your rig
            in seconds.
          </p>
        </div>

        <form
          action="#"
          method="post"
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            type="email"
            name="email"
            required
            placeholder="you@email.com"
            aria-label="Email address"
            className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-4 py-3 outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
          <button
            type="submit"
            disabled
            className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-3 font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Join waitlist
          </button>
        </form>

        <p className="text-xs text-zinc-500">
          Waitlist form is placeholder-only during scaffolding (S1). Wired up in S2.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <Feature
            title="Verified tones"
            body="Famous songs cite authoritative sources — interviews, rig rundowns, manufacturer pages."
          />
          <Feature
            title="Confidence badges"
            body="We show how certain we are. ✓ Verified · ⚠ Inferred · ⚠ Speculative."
          />
          <Feature
            title="Your rig, honestly"
            body="Translation accounts for pickup output, amp voicing, and gear you actually own."
          />
        </div>
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{title}</span>
      <span className="text-zinc-600 dark:text-zinc-400">{body}</span>
    </div>
  );
}
