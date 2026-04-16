-- =============================================================================
-- ToneBridge — Zero-Human Track tables (S2)
-- Master plan §6.6.12
--
-- - eval_history: nightly 20-song regression scores
-- - rejection_log: auto-rejected candidates (from Dual-Judge) with fallback trail
-- - system_flags: global feature toggles (e.g. auto_insertion_halted)
-- =============================================================================

CREATE TABLE eval_history (
  id            SERIAL PRIMARY KEY,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  avg_score     NUMERIC(3,2) NOT NULL,
  results       JSONB NOT NULL,              -- per-song [{song, score}]
  model_primary TEXT,                         -- 'gemini-1.5-flash' etc
  halted_after  BOOLEAN NOT NULL DEFAULT false   -- whether this run triggered the halt
);

CREATE INDEX idx_eval_history_recent ON eval_history(run_at DESC);

CREATE TABLE rejection_log (
  id               SERIAL PRIMARY KEY,
  song             TEXT NOT NULL,
  artist           TEXT NOT NULL,
  section          song_section,
  reason           TEXT NOT NULL,              -- 'dual_judge_fail' 'no_sources' 'schema_parse_fail' etc
  extraction       JSONB,                      -- final merged extraction (may be null if extraction failed)
  sources          JSONB,
  judges           JSONB,                      -- {j1, j2} dual-judge verdicts
  fallback_action  TEXT,                       -- 'tier_b_llm_only' 'none'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rejection_log_recent ON rejection_log(created_at DESC);
CREATE INDEX idx_rejection_log_reason ON rejection_log(reason);

CREATE TABLE system_flags (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  reason      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: service_role only
ALTER TABLE eval_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejection_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_flags  ENABLE ROW LEVEL SECURITY;
