# ToneBridge

**Your gear, any guitar tone.**

Text-based guitar tone recommender. Onboard your rig once, search any song, and get amp settings + pedal chain + playing tips translated to your specific guitar and amp.

> This is a temporary working name. Brand/domain decision is §16 #2 in the master plan and may change before public launch.

---

## Source of Truth

All design, rationale, and execution plans live in the adjacent research repo:

```
C:\Users\pjhic\Projects\guitar_tone_ai\plan\
├── LAYER1-MASTER-EXECUTION-PLAN.md    ← Primary execution plan (read this first)
├── DATA-AUTOMATION-PIPELINE.md        ← Reference for data pipeline details
├── SEED-CATALOG-STRATEGY.md           ← 2-Tier catalog (A/B) strategy
└── DATA-SOURCING-STRATEGY.md          ← Legal/ToS principles for data collection
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

## Local Setup

```bash
# 1. Install
npm install

# 2. Copy env template
cp .env.example .env.local
# Fill in your local dev keys:
#   - Supabase (free project)
#   - GEMINI_API_KEY (aistudio.google.com)
#   - GROQ_API_KEY (console.groq.com)
#   - BRAVE_API_KEY (api.search.brave.com)

# 3. Run migrations (after S2)
npm run db:push

# 4. Dev server
npm run dev
```

Open http://localhost:3000.

---

## Directory Structure

```
tonebridge-web/
├── app/                       # Next.js App Router
│   ├── (marketing)/          # public landing, /community/*
│   ├── (app)/                # authed: onboarding, search, result, library
│   ├── api/                  # research-tone, adapt-tone, lookups, webhooks
│   └── auth/                 # OAuth callback
├── components/
│   ├── ui/                   # shadcn/ui primitives
│   ├── gear-picker/          # guitar/amp/multi-fx search
│   ├── result-card/          # AmpKnobs, PedalChain, ConfidenceBadge
│   └── onboarding/
├── lib/
│   ├── supabase/             # client/server/admin clients
│   ├── db/                   # drizzle client & schema
│   ├── llm/                  # multi-provider abstraction (Gemini/Groq/OpenAI)
│   ├── automation/           # zero-human data pipeline (phase 0-6)
│   ├── stripe/
│   ├── credits.ts
│   └── ratelimit.ts
├── scripts/
│   ├── seed/                 # gear DB seeds, tier A/B song seeds
│   ├── automation/           # run-tier-a, nightly-eval
│   └── eval/                 # 20-song evaluation harness
├── supabase/
│   ├── migrations/           # SQL migrations (authoritative)
│   └── seed.sql
├── emails/                   # React Email templates
└── middleware.ts             # route guards (auth, onboarding gate)
```

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run db:push` | (S2+) Drizzle push schema to Supabase |
| `npm run db:studio` | (S2+) Drizzle Studio |
| `npm run seed:gear` | (S7) Seed guitar/amp/pedal DB |
| `npm run run:tier-a` | (S8) Execute Tier A 300-song pipeline |

---

## Progress

Currently at **S1: Scaffold** (of 15-session plan). See tracker in master plan §14.

Go-gate checkpoints: S2 (DB connected) · **S6 (pilot quality ★)** · S9 (data scale) · S13 (E2E flow) · S15 (launch ready).
