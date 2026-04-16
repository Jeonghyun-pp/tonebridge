# Supabase Migrations

Authoritative source of truth for the DB schema.

## Files (applied in S2)

- `0001_core_schema.sql` — gear, reference_tones, users, user_gear, saved_tones, research_cache, usage_logs, feedback_events
- `0002_indexes.sql` — pg_trgm, GIN, FTS
- `0003_rls.sql` — row-level security policies
- `0005_gear_expansion.sql` — gear_expansion_queue (LLM-extracted gear not yet in DB)
- `0006_candidates.sql` — tone_candidates (human review queue, Budget Track)
- `0007_zero_human.sql` — eval_history, rejection_log, system_flags (Zero-Human Track)

## How migrations run

Manual apply via Supabase Studio SQL editor or via `drizzle-kit push` after S2 schema files are written.

See master plan §4 for full SQL.
