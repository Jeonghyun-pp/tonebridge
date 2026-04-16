# Seed Scripts

Static data seeds for gear DB and Tier B batch generation.

## Files

- `gear.ts` (S7) — insert `data/guitars.json`, `data/amps.json`, `data/pedals.json`
- `gen_knob_notes.ts` (S7) — LLM draft generation for amp knob_notes
- `tier_b_batch.ts` (S9) — Gemini Free loop to generate 1,200-song Tier B

## Data files

- `data/guitars.json` — 300 guitars (brand, model, pickup_config, pickup_output_mv, character_tags)
- `data/amps.json` — 200 amps + `knob_notes` for Tier S 50
- `data/pedals.json` — 400 pedals by category
- `data/tier_a_seeds.json` — 300 songs (auto-generated + human-approved)
- `data/tier_b_seeds.json` — 1,200 songs (Billboard/Spotify top + genre quotas)

See master plan §5-6 and SEED-CATALOG-STRATEGY.md.
