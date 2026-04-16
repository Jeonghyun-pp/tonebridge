# Automation Library

Phase-by-phase modules for the Zero-Human data pipeline.

Implemented in S4-S5 (master plan §6.6.6-§6.6.11).

## Files

- `fetch-guard.ts` — robots.txt + rate limit + User-Agent compliant HTTP fetch
- `phase0-wiki-first.ts` — Wikipedia REST API extraction
- `phase1-metadata.ts` — MusicBrainz + Discogs
- `phase2-brave.ts` — Brave Search API
- `phase3-multi-llm.ts` — 3-run consensus (Gemini×2 + Groq×1)
- `phase4-normalize.ts` — pg_trgm fuzzy match to gear DB
- `phase5-score.ts` — tier-weighted confidence
- `phase6-dual-judge.ts` — Gemini + Groq citation verification
- `tier-b-fallback.ts` — fallback when Phase 2 has no sources
- `storage-guard.ts` — runtime guard against DB writes containing raw HTML
- `schemas.ts` — Zod schemas for extraction / judge outputs
