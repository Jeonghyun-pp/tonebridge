-- =============================================================================
-- ToneBridge — Row Level Security (S2)
-- Master plan §4.3
--
-- Intent:
-- - users/user_gear/saved_tones/feedback_events: owner-only via auth.uid()
-- - gear/reference_tones: public read (catalog), service_role writes
-- - All other tables: service_role only (no public access)
-- =============================================================================

-- -----------------------------
-- users — self only
-- -----------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_select ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_self_update ON users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- -----------------------------
-- user_gear — owner only
-- -----------------------------
ALTER TABLE user_gear ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_gear_owner ON user_gear
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- -----------------------------
-- saved_tones — owner only
-- -----------------------------
ALTER TABLE saved_tones ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_tones_owner ON saved_tones
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- -----------------------------
-- feedback_events — owner insert, read own
-- -----------------------------
ALTER TABLE feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY feedback_insert_own ON feedback_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY feedback_read_own ON feedback_events
  FOR SELECT USING (auth.uid() = user_id);

-- -----------------------------
-- Public read catalogs (gear + reference tones)
-- Writes are performed via service_role in API routes.
-- -----------------------------
ALTER TABLE guitars ENABLE ROW LEVEL SECURITY;
CREATE POLICY guitars_public_read ON guitars FOR SELECT USING (true);

ALTER TABLE amps ENABLE ROW LEVEL SECURITY;
CREATE POLICY amps_public_read ON amps FOR SELECT USING (true);

ALTER TABLE pedals ENABLE ROW LEVEL SECURITY;
CREATE POLICY pedals_public_read ON pedals FOR SELECT USING (true);

ALTER TABLE reference_tones ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_tones_public_read ON reference_tones FOR SELECT USING (true);

-- -----------------------------
-- Service-role-only tables (no policies = locked down to service_role).
-- ENABLE RLS without policies means nobody except service_role can access.
-- -----------------------------
ALTER TABLE research_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs     ENABLE ROW LEVEL SECURITY;
