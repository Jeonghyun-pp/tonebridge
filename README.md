# ToneBridge

**Your gear, any guitar tone.**

Text-based guitar tone recommender. Onboard your rig once, search any song, and get amp settings + pedal chain + playing tips translated to your specific guitar and amp.

> Working name — may change before public launch (master plan §16 #2).

---

## 🚦 Status: Phase I complete (11 / 15 sessions)

All code that can be written without live external services is done and passes type checks + 74 unit tests. The remaining 4 sessions all require credentials (Supabase, LLM, Brave, Stripe, Vercel) and real network access.

```
Phase I (code-only, no credentials)   ██████████████████  11 / 11  ✅
Phase II (requires credentials)        ░░░░░░░░░░░░░░░░    0 / 4
```

---

## Source of Truth

All design, rationale, and execution plans live in the adjacent research repo:

```
C:\Users\pjhic\Projects\guitar_tone_ai\plan\
├── LAYER1-MASTER-EXECUTION-PLAN.md   ← Primary execution plan (read this first)
├── DATA-AUTOMATION-PIPELINE.md       ← Reference for data pipeline details
├── SEED-CATALOG-STRATEGY.md          ← 2-Tier catalog (A/B) strategy
└── DATA-SOURCING-STRATEGY.md         ← Legal/ToS principles for data collection
```

Do not duplicate plan content into this repo. When plans evolve, update them there.

---

## Stack (Zero-Cost Track)

| Layer | Choice | Free tier |
|-------|--------|-----------|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind v4 | — |
| DB + Auth | Supabase | 500MB / 50K MAU |
| LLM (primary) | Google Gemini 1.5 Flash | 15 RPM, 1,500 req/day |
| LLM (consensus) | Groq Llama 3.3 70B | 30 RPM |
| LLM (fallback) | OpenAI gpt-4o-mini | reserve budget |
| Search | Brave Search API | 2,000 query/month |
| Cache / rate limit | Upstash Redis | 10K cmd/day |
| Background jobs | Upstash QStash | generous free tier |
| Payments | Stripe | transaction fees only |
| Email | Resend | 3,000 email/month |
| Analytics | PostHog Cloud | 1M events/month |
| Hosting | Vercel Hobby → Cloudflare Pages (M3) | both free |

**Baseline monthly cost**: ~$1 (domain only).

---

## Session tracker

Derived from master plan §14 (M0 → M3). Each session is a self-contained, committable chunk.

### ✅ Phase I — code-only (done)

- [x] **S1** · Next.js scaffold + directory structure · `c8f59b7`
- [x] **S2** · Supabase migrations (8 files) + Drizzle schema + query helpers · `6573084`
- [x] **S3** · LLM abstraction (Gemini / Groq / OpenAI) + Gemini schema compat · `eda2bef`
- [x] **S4** · Phase 0-2 automation (Wikipedia-first, MusicBrainz, Brave, fetch-guard) · `9c4804f`
- [x] **S5** · Phase 3-6 Zero-Human (multi-LLM consensus, dual-judge, Tier B fallback, storage-guard) · `120c08e`
- [x] **S7** · Gear seed catalog — 51 guitars, 30 amps (15 with `knob_notes`), 60 pedals · `83dbed3`
- [x] **S10** · API routes: research-tone, adapt-tone, lookups, feedback, credits, songs/search · `4c726c5`
- [x] **S11** · Supabase Auth + middleware (auth gate) + layout (onboarding gate) + 3-step onboarding UI · `2a01577`
- [x] **S12** · Main flow UI: `/search`, `/result/[id]`, `/library` + 6 result-card components · `3b6ba57`
- [x] **S13** · Stripe Checkout + Portal + webhook + `/pricing` + credits header widget · `e53669e`
- [x] **S14** · `/community` SSR + sitemap + robots + OG image + nightly eval cron + Vercel config · `d21826b`

### ⏳ Phase II — requires credentials

- [ ] **S6 ★** · Pilot 20 songs through full Phase 0-6 pipeline → **Go-gate** (auth ≥ 40%, reject ≤ 40%, judge vs human ≥ 90%)
- [ ] **S8** · Tier A 290 songs end-to-end (Day 1 / Day 2 split to respect Gemini 1,500 req/day quota)
- [ ] **S9** · Tier B 1,200 songs via Gemini Free loop + 120-song QA spot-check
- [ ] **S15** · Final bug bash + launch checklist + Public launch (Product Hunt / r/guitar / TikTok)

---

## ✅ What works without credentials (verified)

| Area | Verification | Result |
|------|-------------|--------|
| TypeScript compile | `npx tsc --noEmit` | clean |
| Gemini JSON Schema converter | 10 unit tests | pass |
| URL fetch-guard, HTML strip, domain whitelist | 15 unit tests | pass |
| Multi-LLM consensus merge logic | 13 unit tests | pass |
| Confidence scoring + mode decision | 7 unit tests | pass |
| Dual-judge decision function | 6 unit tests | pass |
| Storage guard (raw HTML DB-write blocker) | 7 unit tests | pass |
| URL slug round-trip (English + Korean) | 6 unit tests | pass |
| Eval scoring + halt decision | 10 unit tests | pass |
| JSON seed data integrity | `node -e` sanity check | 141 entries OK |
| Dev server boots | (S1 initial check) | port 3000, build OK |

**Total: 74 unit tests across 5 suites, 100% passing.**

Run all tests:
```bash
for t in scripts/eval/test-*.ts; do npx tsx "$t"; done
```

## ✗ What needs credentials (Phase II)

| Capability | Missing key(s) |
|-----------|---------------|
| Supabase DB access | `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*` |
| Gemini / Groq LLM calls | `GEMINI_API_KEY`, `GROQ_API_KEY` |
| Brave Search source discovery | `BRAVE_API_KEY` |
| Stripe Checkout / Portal / webhook | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO_MONTHLY` |
| Rate limiting | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Email magic links | Supabase Auth SMTP settings |
| Google OAuth | Supabase Auth provider config |
| Discogs credits enrichment | `DISCOGS_KEY`, `DISCOGS_SECRET` (optional — skips silently without) |
| Nightly cron auth | `CRON_SECRET` (optional for dev) |

---

## Phase II setup checklist

Estimated total time: ~2-3 hours of user work spread across providers.

### Stage A — S6 pilot ready (~1 hour)

- [ ] Create Supabase Free project (name: `tonebridge`)
- [ ] In Supabase SQL editor, run migrations `0001` → `0008` in order
  - Location: `supabase/migrations/*.sql`
- [ ] Collect 4 Supabase keys into `.env.local`
- [ ] Get Gemini API key at https://aistudio.google.com/app/apikey
- [ ] Get Groq API key at https://console.groq.com/keys
- [ ] Get Brave Search API key at https://api.search.brave.com (Free tier)
- [ ] `cp .env.example .env.local` and fill in all of the above
- [ ] `npm install` (if not already done)
- [ ] `npm run seed:gear` → populate DB with 141 gear entries
- [ ] `npm run dev` → verify http://localhost:3000 loads landing page
- [ ] Signal **S6 ready**

### Stage B — M2 ready (~1 hour)

- [ ] Stripe test account → create subscription product → note `STRIPE_PRICE_ID_PRO_MONTHLY`
- [ ] `stripe listen --forward-to localhost:3000/api/stripe/webhook` → get webhook secret
- [ ] Upstash Redis Free → note REST URL + token
- [ ] PostHog Cloud Free → project key
- [ ] Resend Free → API key
- [ ] Configure Supabase Auth → Google OAuth provider (optional)
- [ ] Configure Supabase Auth → email SMTP (for magic links)

### Stage C — M3 launch (~30 min)

- [ ] Domain purchased + DNS pointed (temp: use `tonebridge.vercel.app`)
- [ ] Vercel Hobby: Import GitHub repo → add all env vars
- [ ] Generate `CRON_SECRET` via `openssl rand -hex 32`
- [ ] Verify `/api/cron/nightly-eval` runs at 02:00 UTC

---

## Local setup

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env.local
# Fill in your local dev keys per checklist above.

# 3. Migrations (if DB is set up)
# Apply supabase/migrations/*.sql via Supabase SQL editor.
# Drizzle-kit alternative:
npm run db:push

# 4. Seed gear
npm run seed:gear

# 5. Dev server
npm run dev
```

Open http://localhost:3000.

---

## Directory structure (actual)

```
tonebridge-web/
├── app/
│   ├── (app)/                      # auth-gated routes
│   │   ├── layout.tsx              # onboarding gate + header + credits widget
│   │   ├── onboarding/page.tsx     # 3-step state machine
│   │   ├── search/page.tsx         # song autocomplete + generate
│   │   ├── result/[id]/page.tsx    # full result card
│   │   └── library/page.tsx        # saved tones list
│   ├── auth/
│   │   ├── signin/page.tsx         # magic link + Google
│   │   ├── callback/route.ts
│   │   └── signout/route.ts
│   ├── community/                  # public SEO surface
│   │   ├── page.tsx                # index
│   │   └── [slug]/page.tsx         # detail + OG
│   ├── pricing/page.tsx            # Free vs Pro
│   ├── api/                        # route handlers
│   │   ├── research-tone/          # Stage 1 + cache resolution
│   │   ├── adapt-tone/             # Stage 2 + saved_tones
│   │   ├── guitars/lookup, amps/lookup, pedals/search
│   │   ├── songs/search            # MusicBrainz proxy
│   │   ├── feedback/               # 👍/👎 + auto-downgrade
│   │   ├── credits/                # header widget read-only
│   │   ├── gear-onboarding/{complete,status}
│   │   ├── stripe/{checkout,portal,webhook}
│   │   ├── og/                     # dynamic OG image
│   │   └── cron/nightly-eval/      # Vercel cron target
│   ├── sitemap.ts · robots.ts · page.tsx (landing) · layout.tsx · globals.css
├── components/
│   ├── onboarding/                 # step-shell + 3 steps + reusable gear-search
│   ├── result-card/                # ConfidenceBadge + AmpKnobs + PedalChain +
│   │                               #   MissingPedals + PlayingTips + FeedbackButtons
│   ├── credits-display.tsx         # header widget
│   └── upgrade-button.tsx          # Stripe client island
├── lib/
│   ├── supabase/                   # client.ts (browser) + server.ts (RSC/API)
│   │                               #   + admin.ts (service role) + middleware.ts (edge)
│   ├── db/                         # client.ts (drizzle) + schema.ts + queries.ts
│   ├── llm/                        # provider.ts + schema-compat.ts
│   │                               #   + research-tone.ts + adapt-tone.ts + api-schemas.ts
│   ├── automation/                 # phase0-6 + tier-b-fallback + storage-guard
│   │                               #   + fetch-guard + schemas.ts
│   ├── community/                  # slug.ts + scoring.ts
│   ├── stripe/client.ts
│   ├── credits.ts · ratelimit.ts · auth.ts · utils.ts
├── scripts/
│   ├── seed/
│   │   ├── gear.ts                 # JSON → DB seeder
│   │   └── data/{guitars,amps,pedals}.json   # 141 entries
│   ├── eval/
│   │   ├── run.ts                  # research-tone regression runner
│   │   ├── eval-set.json           # 5 songs (placeholder; expand to 20 in Phase II)
│   │   └── test-*.ts               # 5 test suites · 74 assertions
│   └── automation/README.md        # driver scripts added during Phase II wiring
├── supabase/migrations/
│   ├── 0001_core_schema.sql        # 10 tables + 4 enums + extensions
│   ├── 0002_indexes.sql            # pg_trgm + FTS + per-table indexes
│   ├── 0003_rls.sql                # owner-only / public / service-only
│   ├── 0005_gear_expansion.sql     # auto-grown gear DB queue
│   ├── 0006_candidates.sql         # Budget Track human review queue
│   ├── 0007_zero_human.sql         # eval_history + rejection_log + system_flags
│   └── 0008_auth_user_sync.sql     # auth.users → public.users trigger
├── middleware.ts                   # auth gate only — onboarding gate is in (app)/layout
├── vercel.json                     # cron schedule + function maxDuration
├── drizzle.config.ts · next.config.ts · tsconfig.json · tailwind v4 via postcss.config
├── .env.example · .gitignore · components.json (shadcn config)
└── package.json (26 runtime + 12 dev deps)
```

---

## Scripts

| Command | Purpose | Available |
|---------|---------|-----------|
| `npm run dev` | Next.js dev server | now |
| `npm run build` | Production build | now |
| `npm run lint` | ESLint | now |
| `npm run db:push` | Drizzle push schema to Supabase | S2 |
| `npm run db:studio` | Drizzle Studio UI | S2 |
| `npm run seed:gear` | Seed 141 gear entries from JSON | S7 |
| `npm run seed:tier-a-list` | Auto-generate Tier A seed list | Phase II |
| `npm run run:tier-a` | Execute Tier A 290-song pipeline | S8 |
| `npm run run:tier-b` | Execute Tier B 1,200-song batch | S9 |
| `npm run eval:run` | Run eval regression against current prompts | now (needs keys) |

---

## Go-gates

Each gate is a hard checkpoint before moving to the next phase.

| Gate | Location | Criteria |
|------|----------|----------|
| DB connected | S2 end | `SELECT 1` round-trip + empty-table select |
| **Pilot quality ★** | **S6 end** | auth ≥ 40% **and** reject ≤ 40% **and** judge vs human agreement ≥ 90% |
| Data scale | S9 end | `reference_tones` ≥ 1,500 rows, auth ≥ 150 |
| E2E flow | S13 end | signup → onboarding → search → result → save → revisit passes manually |
| Launch ready | S15 start | every item in §13 launch checklist |

---

## Known risks

| Risk | Trigger | Mitigation |
|------|---------|-----------|
| Gemini `responseSchema` rejects our converted JSON Schema | S6 first call | `schema-compat` already has 10 unit tests + common pattern handling; falls back to Groq automatically |
| Multi-LLM consensus yields too low (>40% rejection) | S6 | Lower threshold (2/3 → 1/2) or expand seed to 450 to reach 300 auth target |
| Tier S `knob_notes` accuracy uneven | Live usage | Surface via 👎 auto-downgrade; expand via demand (`gear_expansion_queue`) |
| Vercel Hobby commercial ToS | M3 public launch | Migrate to Cloudflare Pages (planned in S14) or upgrade to Pro |
| Drizzle + Supabase pooler connection saturation | DAU 100+ | `prepare: false` already set; monitor and upgrade DB tier if needed |
| Stripe webhook 500 without `STRIPE_WEBHOOK_SECRET` | Before key set | Intended — tests locally via `stripe listen` |
| 👎 abuse (manual downgrade spam) | Post-launch | Rate limit via `feedbackLimit` (20/min); add per-user vote cap if needed |
| Cron `maxDuration` exceeded on Hobby tier | Nightly eval | `maxDuration: 300` in `vercel.json`; Pro tier supports it; Hobby may require externalization |

---

## Repo

- Origin: https://github.com/Jeonghyun-pp/tonebridge
- Branch: `main` tracks `origin/main`
- 11 commits pushed as of Phase I close
