-- =============================================================================
-- ToneBridge — Core schema (S2)
-- Master plan §4.1
--
-- Apply order: 0001 → 0002 (indexes) → 0003 (RLS) → 0005 → 0006 → 0007
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- gear/song fuzzy search
CREATE EXTENSION IF NOT EXISTS unaccent;     -- accent normalization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE tone_mode AS ENUM ('authoritative', 'inferred', 'speculative');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE tone_type AS ENUM ('clean', 'crunch', 'distorted', 'high_gain', 'ambient', 'acoustic');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE song_section AS ENUM ('intro', 'verse', 'chorus', 'riff', 'solo', 'bridge', 'outro', 'clean_intro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('free', 'pro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- GEAR DB
-- =============================================================================
CREATE TABLE guitars (
  id                 SERIAL PRIMARY KEY,
  brand              TEXT NOT NULL,
  model              TEXT NOT NULL,
  pickup_config      TEXT,                   -- 'SSS' 'HH' 'HSS' 'HSH' 'P90' 'SS'
  pickup_output_mv   INTEGER,                -- average pickup output (key for Stage 2 translation)
  body_wood          TEXT,
  scale_length_in    NUMERIC(3,1),           -- 24.75, 25.5
  character_tags     TEXT[] DEFAULT '{}',    -- ['bright','percussive','warm','versatile']
  aliases            TEXT[] DEFAULT '{}',    -- ['Strat','Stratocaster','American Strat']
  popularity         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand, model)
);

CREATE TABLE amps (
  id                 SERIAL PRIMARY KEY,
  brand              TEXT NOT NULL,
  model              TEXT NOT NULL,
  voicing            TEXT,                   -- 'american_scooped','british_midforward','modern_tight','vintage_loose'
  character_tags     TEXT[] DEFAULT '{}',    -- ['bright','scooped','tight_lows','compressed']
  watts              INTEGER,
  clean_headroom     TEXT,                   -- 'low' 'medium' 'high'
  knob_layout        JSONB,                  -- {"gain":true,"bass":true,"mid":true,"treble":true,"presence":true,"reverb":true}
  knob_notes         TEXT,                   -- ★ Stage 2 prompt injection (voicing profile)
  typical_genres     TEXT[] DEFAULT '{}',    -- ['metal','modern_rock']
  is_modeler         BOOLEAN NOT NULL DEFAULT false,   -- Helix/Kemper/Axe distinction
  aliases            TEXT[] DEFAULT '{}',
  popularity         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand, model)
);

CREATE TABLE pedals (
  id                 SERIAL PRIMARY KEY,
  brand              TEXT NOT NULL,
  model              TEXT NOT NULL,
  category           TEXT NOT NULL,          -- overdrive/distortion/fuzz/delay/reverb/chorus/phaser/flanger/wah/compressor/eq/boost/tremolo/vibrato/pitch/looper
  subcategory        TEXT,                   -- 'tube_screamer_clone','analog_delay','plate_reverb'
  character_tags     TEXT[] DEFAULT '{}',    -- ['mid_hump','transparent','dark','bright']
  typical_settings   JSONB,                  -- {"drive":"5-7","tone":"6","level":"7"}
  aliases            TEXT[] DEFAULT '{}',
  popularity         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand, model)
);

-- =============================================================================
-- REFERENCE TONE DB
-- =============================================================================
CREATE TABLE reference_tones (
  id                         SERIAL PRIMARY KEY,
  song                       TEXT NOT NULL,
  artist                     TEXT NOT NULL,
  section                    song_section NOT NULL DEFAULT 'riff',
  tone_type                  tone_type,
  instrument                 TEXT NOT NULL DEFAULT 'guitar',  -- 'guitar' | 'bass'
  genre                      TEXT,
  era                        TEXT,                            -- '1970s' '2010s'
  year                       INTEGER,

  -- Reference gear (FK match + free-text fallback)
  reference_guitar_id        INTEGER REFERENCES guitars(id),
  reference_guitar_freetext  TEXT,
  reference_amp_id           INTEGER REFERENCES amps(id),
  reference_amp_freetext     TEXT,
  reference_pedals           JSONB,    -- [{pedal_id?, freetext?, position, settings, confidence, sources}]

  -- Tone settings
  reference_settings         JSONB NOT NULL,    -- {"gain":7,"bass":6,"mid":5,"treble":7,"presence":7,"reverb":0}
  guitar_knob_settings       JSONB,             -- {"volume":"8-10","tone":"7-8"} — string ranges (ToneAdapt-compatible)
  pickup_choice              TEXT,              -- 'bridge' 'neck' 'middle' 'bridge+middle'

  -- Metadata
  tone_characteristics       TEXT[] DEFAULT '{}',   -- ['crunchy','mid_heavy','percussive']
  song_context               TEXT,                  -- "raunchy mid-heavy crunch for the main riff"
  sources                    TEXT[] NOT NULL DEFAULT '{}',   -- URLs ONLY (never raw text)
  confidence                 NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  mode                       tone_mode NOT NULL DEFAULT 'inferred',

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (song, artist, section, tone_type, instrument)
);

-- =============================================================================
-- USERS & BILLING
-- =============================================================================
CREATE TABLE users (
  id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    TEXT UNIQUE,
  display_name             TEXT,
  referral_source          TEXT,                      -- onboarding step 1 "How did you hear?"
  subscription_tier        subscription_tier NOT NULL DEFAULT 'free',
  stripe_customer_id       TEXT UNIQUE,
  stripe_subscription_id   TEXT,
  subscription_status      TEXT,                      -- Stripe status cache
  trial_ends_at            TIMESTAMPTZ,
  daily_credits_used       INTEGER NOT NULL DEFAULT 0,
  daily_credits_reset_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  onboarding_complete      BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_gear (
  id               SERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guitar_id        INTEGER REFERENCES guitars(id),
  guitar_freetext  TEXT,                          -- when not in DB
  amp_id           INTEGER REFERENCES amps(id),
  amp_freetext     TEXT,
  multi_fx_id      INTEGER REFERENCES amps(id),   -- when is_modeler=true
  pedals           INTEGER[] NOT NULL DEFAULT '{}',  -- pedal ids
  pedal_freetext   TEXT[] NOT NULL DEFAULT '{}',
  is_default       BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_gear_default_unique ON user_gear(user_id) WHERE is_default = true;

CREATE TABLE saved_tones (
  id                    SERIAL PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_tone_id     INTEGER REFERENCES reference_tones(id),
  song_query            TEXT,                       -- lazy cache (songs not in ref DB)
  artist_query          TEXT,
  adapted_settings      JSONB NOT NULL,             -- Stage 2 result
  user_gear_snapshot    JSONB NOT NULL,             -- user gear frozen at translation time
  research_response     JSONB,                      -- Stage 1 raw (for audit/replay)
  feedback              INTEGER,                    -- -1 | 0 | 1
  feedback_note         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- CACHE & LOGS
-- =============================================================================
CREATE TABLE research_cache (
  id           SERIAL PRIMARY KEY,
  song         TEXT NOT NULL,
  artist       TEXT NOT NULL,
  section      song_section NOT NULL DEFAULT 'riff',
  tone_type    tone_type,
  result       JSONB NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 0,
  enriched     BOOLEAN NOT NULL DEFAULT false,       -- Tier C enrichment marker
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (song, artist, section, tone_type)
);

CREATE TABLE usage_logs (
  id                  SERIAL PRIMARY KEY,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  endpoint            TEXT NOT NULL,             -- '/api/research-tone' etc
  model               TEXT,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  cost_usd            NUMERIC(10,6),
  latency_ms          INTEGER,
  cache_hit           BOOLEAN NOT NULL DEFAULT false,
  mode                tone_mode,
  success             BOOLEAN NOT NULL DEFAULT true,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback_events (
  id                   SERIAL PRIMARY KEY,
  user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_tone_id        INTEGER REFERENCES saved_tones(id) ON DELETE CASCADE,
  reference_tone_id    INTEGER REFERENCES reference_tones(id),
  rating               INTEGER NOT NULL CHECK (rating BETWEEN -1 AND 1),
  comment              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
