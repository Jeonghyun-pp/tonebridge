# Automation Scripts

Zero-Human data pipeline (master plan §6.6, DATA-AUTOMATION-PIPELINE §19).

## Files (added incrementally)

- `generate-seed-list.ts` (S4) — MusicBrainz + Wikipedia chart → Tier A seed
- `run-tier-a-zero-human.ts` (S5) — end-to-end pipeline driver
- `nightly-eval.ts` (S14) — 20-song regression check

## Pipeline phases

0. **Phase 0** — Wikipedia-first extraction (40~60% hit rate for famous songs)
1. **Phase 1** — MusicBrainz + Discogs metadata enrichment
2. **Phase 2** — Brave Search (whitelisted domains only)
3. **Phase 3** — Multi-LLM consensus extraction (Gemini×2 + Groq×1)
4. **Phase 4** — Gear DB fuzzy matching + gear_expansion_queue
5. **Phase 5** — Confidence scoring (tier-weighted)
6. **Phase 6** — Dual-Judge (Gemini + Groq) → auto-approve / auto-reject

Outputs written to `reference_tones` (approved) or `rejection_log` (rejected).

See master plan §6.6.11 for full driver code.
