-- =============================================================================
-- ToneBridge — Tone Candidates (S2)
-- DATA-AUTOMATION-PIPELINE §7.3 (Budget Track human review queue)
--
-- Also used by Zero-Human Track: candidates that Dual-Judge rejects
-- are written to rejection_log (0007), not here. This table holds
-- items that need human attention (partial judge PASS, or shadow-mode
-- audit during the first 100 songs post-launch).
-- =============================================================================

CREATE TABLE tone_candidates (
  id                  SERIAL PRIMARY KEY,
  song                TEXT NOT NULL,
  artist              TEXT NOT NULL,
  section             song_section,
  tone_type           tone_type,

  extraction          JSONB NOT NULL,              -- Phase 3 result
  sources             JSONB NOT NULL,              -- Phase 2 URLs + tier
  judge_result        JSONB,                       -- Phase 6 dual-judge output

  auto_mode           tone_mode,
  auto_confidence     NUMERIC(3,2) CHECK (auto_confidence BETWEEN 0 AND 1),

  status              TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'edited'
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  final_tone_id       INTEGER REFERENCES reference_tones(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tone_candidates_queue
  ON tone_candidates(status, auto_confidence DESC);

ALTER TABLE tone_candidates ENABLE ROW LEVEL SECURITY;   -- service_role only
