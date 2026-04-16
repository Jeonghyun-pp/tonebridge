-- =============================================================================
-- ToneBridge — Indexes (S2)
-- Master plan §4.2
-- =============================================================================

-- Full-text search on songs (ToneAdapt-style "Song + Artist" search)
CREATE INDEX idx_ref_tones_fts ON reference_tones
  USING GIN (to_tsvector('english', unaccent(song) || ' ' || unaccent(artist)));

-- Trigram fuzzy matching on gear (Supabase pg_trgm default similarity ≥ 0.3)
CREATE INDEX idx_guitars_model_trgm ON guitars USING GIN (model gin_trgm_ops);
CREATE INDEX idx_guitars_brand_trgm ON guitars USING GIN (brand gin_trgm_ops);
CREATE INDEX idx_guitars_aliases   ON guitars USING GIN (aliases);

CREATE INDEX idx_amps_model_trgm   ON amps USING GIN (model gin_trgm_ops);
CREATE INDEX idx_amps_brand_trgm   ON amps USING GIN (brand gin_trgm_ops);
CREATE INDEX idx_amps_aliases      ON amps USING GIN (aliases);
CREATE INDEX idx_amps_is_modeler   ON amps(is_modeler) WHERE is_modeler = true;

CREATE INDEX idx_pedals_model_trgm ON pedals USING GIN (model gin_trgm_ops);
CREATE INDEX idx_pedals_category   ON pedals(category);
CREATE INDEX idx_pedals_aliases    ON pedals USING GIN (aliases);

-- Reference tones filters
CREATE INDEX idx_ref_tones_mode   ON reference_tones(mode);
CREATE INDEX idx_ref_tones_genre  ON reference_tones(genre);

-- User-scoped queries
CREATE INDEX idx_saved_tones_user ON saved_tones(user_id, created_at DESC);
CREATE INDEX idx_user_gear_user   ON user_gear(user_id);

-- Cache lookup
CREATE INDEX idx_research_cache_lookup ON research_cache(song, artist, section, tone_type);

-- Usage analytics
CREATE INDEX idx_usage_logs_user_time     ON usage_logs(user_id, created_at DESC);
CREATE INDEX idx_usage_logs_endpoint_time ON usage_logs(endpoint, created_at DESC);
