-- =============================================================================
-- ToneBridge — Gear Expansion Queue (S2)
-- DATA-AUTOMATION-PIPELINE §5.2
--
-- Populated by Phase 4 normalization when an LLM-extracted gear item
-- does not match anything in the main gear DB. Operators prioritize
-- expansion by hit_count DESC (data-driven gear DB growth).
-- =============================================================================

CREATE TABLE gear_expansion_queue (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,                      -- 'guitar' | 'amp' | 'pedal'
  brand       TEXT,
  model       TEXT,
  hit_count   INTEGER NOT NULL DEFAULT 0,         -- number of songs that requested this gear
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (kind, brand, model)
);

CREATE INDEX idx_gear_expansion_priority
  ON gear_expansion_queue(processed, hit_count DESC);

ALTER TABLE gear_expansion_queue ENABLE ROW LEVEL SECURITY;   -- service_role only
