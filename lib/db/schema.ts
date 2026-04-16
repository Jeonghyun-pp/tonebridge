/**
 * Drizzle schema — mirrors supabase/migrations/*.sql for typed access.
 *
 * Authoritative source: SQL files in supabase/migrations/.
 * This file is for TypeScript inference only. `drizzle-kit push` can
 * sync it back, but we prefer hand-rolled SQL migrations for explicit
 * control over extensions, RLS, and enum creation order.
 */
import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  uuid,
  numeric,
  date,
  uniqueIndex,
  index,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// =============================================================================
// ENUMS
// =============================================================================
export const toneModeEnum = pgEnum("tone_mode", [
  "authoritative",
  "inferred",
  "speculative",
]);

export const toneTypeEnum = pgEnum("tone_type", [
  "clean",
  "crunch",
  "distorted",
  "high_gain",
  "ambient",
  "acoustic",
]);

export const songSectionEnum = pgEnum("song_section", [
  "intro",
  "verse",
  "chorus",
  "riff",
  "solo",
  "bridge",
  "outro",
  "clean_intro",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "pro",
]);

// =============================================================================
// JSONB shape types (re-used across tables)
// =============================================================================
export type AmpKnobSettings = {
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence?: number | null;
  reverb?: number | null;
};

export type GuitarKnobSettings = {
  volume: string; // "8-10"
  tone: string;
};

export type KnobLayout = {
  gain?: boolean;
  bass?: boolean;
  mid?: boolean;
  treble?: boolean;
  presence?: boolean;
  reverb?: boolean;
  master?: boolean;
  channel_mode?: string[];
};

export type ReferencePedalEntry = {
  pedal_id?: number;
  name?: string;
  brand?: string;
  model?: string | null;
  category: string;
  position_in_chain?: number;
  purpose?: string | null;
  timing?: string | null;
  settings?: Record<string, string> | null;
  confidence: number;
  sources?: string[];
};

export type TypicalSettings = Record<string, string>; // {"drive":"5-7","tone":"6"}

// =============================================================================
// GEAR DB
// =============================================================================
export const guitars = pgTable(
  "guitars",
  {
    id: serial("id").primaryKey(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    pickupConfig: text("pickup_config"),
    pickupOutputMv: integer("pickup_output_mv"),
    bodyWood: text("body_wood"),
    scaleLengthIn: numeric("scale_length_in", { precision: 3, scale: 1 }),
    characterTags: text("character_tags").array().notNull().default(sql`'{}'::text[]`),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    popularity: integer("popularity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("guitars_brand_model_key").on(t.brand, t.model)]
);

export const amps = pgTable(
  "amps",
  {
    id: serial("id").primaryKey(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    voicing: text("voicing"),
    characterTags: text("character_tags").array().notNull().default(sql`'{}'::text[]`),
    watts: integer("watts"),
    cleanHeadroom: text("clean_headroom"),
    knobLayout: jsonb("knob_layout").$type<KnobLayout>(),
    knobNotes: text("knob_notes"),
    typicalGenres: text("typical_genres").array().notNull().default(sql`'{}'::text[]`),
    isModeler: boolean("is_modeler").notNull().default(false),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    popularity: integer("popularity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("amps_brand_model_key").on(t.brand, t.model)]
);

export const pedals = pgTable(
  "pedals",
  {
    id: serial("id").primaryKey(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    category: text("category").notNull(),
    subcategory: text("subcategory"),
    characterTags: text("character_tags").array().notNull().default(sql`'{}'::text[]`),
    typicalSettings: jsonb("typical_settings").$type<TypicalSettings>(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    popularity: integer("popularity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pedals_brand_model_key").on(t.brand, t.model)]
);

// =============================================================================
// REFERENCE TONES
// =============================================================================
export const referenceTones = pgTable(
  "reference_tones",
  {
    id: serial("id").primaryKey(),
    song: text("song").notNull(),
    artist: text("artist").notNull(),
    section: songSectionEnum("section").notNull().default("riff"),
    toneType: toneTypeEnum("tone_type"),
    instrument: text("instrument").notNull().default("guitar"),
    genre: text("genre"),
    era: text("era"),
    year: integer("year"),

    referenceGuitarId: integer("reference_guitar_id").references(() => guitars.id),
    referenceGuitarFreetext: text("reference_guitar_freetext"),
    referenceAmpId: integer("reference_amp_id").references(() => amps.id),
    referenceAmpFreetext: text("reference_amp_freetext"),
    referencePedals: jsonb("reference_pedals").$type<ReferencePedalEntry[]>(),

    referenceSettings: jsonb("reference_settings").$type<AmpKnobSettings>().notNull(),
    guitarKnobSettings: jsonb("guitar_knob_settings").$type<GuitarKnobSettings>(),
    pickupChoice: text("pickup_choice"),

    toneCharacteristics: text("tone_characteristics").array().notNull().default(sql`'{}'::text[]`),
    songContext: text("song_context"),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    mode: toneModeEnum("mode").notNull().default("inferred"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reference_tones_unique").on(
      t.song,
      t.artist,
      t.section,
      t.toneType,
      t.instrument
    ),
    check("confidence_range", sql`${t.confidence} BETWEEN 0 AND 1`),
  ]
);

// =============================================================================
// USERS & BILLING
// =============================================================================
export const users = pgTable("users", {
  // FK to auth.users(id) — enforced in SQL migration, not in Drizzle
  id: uuid("id").primaryKey(),
  email: text("email").unique(),
  displayName: text("display_name"),
  referralSource: text("referral_source"),
  subscriptionTier: subscriptionTierEnum("subscription_tier").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  dailyCreditsUsed: integer("daily_credits_used").notNull().default(0),
  dailyCreditsResetAt: date("daily_credits_reset_at").notNull().defaultNow(),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userGear = pgTable(
  "user_gear",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    guitarId: integer("guitar_id").references(() => guitars.id),
    guitarFreetext: text("guitar_freetext"),
    ampId: integer("amp_id").references(() => amps.id),
    ampFreetext: text("amp_freetext"),
    multiFxId: integer("multi_fx_id").references(() => amps.id),
    pedals: integer("pedals").array().notNull().default(sql`'{}'::integer[]`),
    pedalFreetext: text("pedal_freetext").array().notNull().default(sql`'{}'::text[]`),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_gear_user_idx").on(t.userId)]
);

export const savedTones = pgTable(
  "saved_tones",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    referenceToneId: integer("reference_tone_id").references(() => referenceTones.id),
    songQuery: text("song_query"),
    artistQuery: text("artist_query"),
    adaptedSettings: jsonb("adapted_settings").notNull(),
    userGearSnapshot: jsonb("user_gear_snapshot").notNull(),
    researchResponse: jsonb("research_response"),
    feedback: integer("feedback"),
    feedbackNote: text("feedback_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_tones_user_idx").on(t.userId, t.createdAt)]
);

// =============================================================================
// CACHE & LOGS
// =============================================================================
export const researchCache = pgTable(
  "research_cache",
  {
    id: serial("id").primaryKey(),
    song: text("song").notNull(),
    artist: text("artist").notNull(),
    section: songSectionEnum("section").notNull().default("riff"),
    toneType: toneTypeEnum("tone_type"),
    result: jsonb("result").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    enriched: boolean("enriched").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("research_cache_unique").on(t.song, t.artist, t.section, t.toneType)]
);

export const usageLogs = pgTable("usage_logs", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  endpoint: text("endpoint").notNull(),
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  latencyMs: integer("latency_ms"),
  cacheHit: boolean("cache_hit").notNull().default(false),
  mode: toneModeEnum("mode"),
  success: boolean("success").notNull().default(true),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedbackEvents = pgTable("feedback_events", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  savedToneId: integer("saved_tone_id").references(() => savedTones.id, { onDelete: "cascade" }),
  referenceToneId: integer("reference_tone_id").references(() => referenceTones.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// GEAR EXPANSION QUEUE (0005)
// =============================================================================
export const gearExpansionQueue = pgTable(
  "gear_expansion_queue",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // 'guitar' | 'amp' | 'pedal'
    brand: text("brand"),
    model: text("model"),
    hitCount: integer("hit_count").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    processed: boolean("processed").notNull().default(false),
  },
  (t) => [uniqueIndex("gear_expansion_unique").on(t.kind, t.brand, t.model)]
);

// =============================================================================
// TONE CANDIDATES (0006 — Budget Track review queue)
// =============================================================================
export const toneCandidates = pgTable("tone_candidates", {
  id: serial("id").primaryKey(),
  song: text("song").notNull(),
  artist: text("artist").notNull(),
  section: songSectionEnum("section"),
  toneType: toneTypeEnum("tone_type"),
  extraction: jsonb("extraction").notNull(),
  sources: jsonb("sources").notNull(),
  judgeResult: jsonb("judge_result"),
  autoMode: toneModeEnum("auto_mode"),
  autoConfidence: numeric("auto_confidence", { precision: 3, scale: 2 }),
  status: text("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  finalToneId: integer("final_tone_id").references(() => referenceTones.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// ZERO-HUMAN TRACK TABLES (0007)
// =============================================================================
export const evalHistory = pgTable("eval_history", {
  id: serial("id").primaryKey(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  avgScore: numeric("avg_score", { precision: 3, scale: 2 }).notNull(),
  results: jsonb("results").notNull(),
  modelPrimary: text("model_primary"),
  haltedAfter: boolean("halted_after").notNull().default(false),
});

export const rejectionLog = pgTable("rejection_log", {
  id: serial("id").primaryKey(),
  song: text("song").notNull(),
  artist: text("artist").notNull(),
  section: songSectionEnum("section"),
  reason: text("reason").notNull(),
  extraction: jsonb("extraction"),
  sources: jsonb("sources"),
  judges: jsonb("judges"),
  fallbackAction: text("fallback_action"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemFlags = pgTable("system_flags", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// Type helpers
// =============================================================================
export type Guitar = typeof guitars.$inferSelect;
export type NewGuitar = typeof guitars.$inferInsert;
export type Amp = typeof amps.$inferSelect;
export type NewAmp = typeof amps.$inferInsert;
export type Pedal = typeof pedals.$inferSelect;
export type NewPedal = typeof pedals.$inferInsert;
export type ReferenceTone = typeof referenceTones.$inferSelect;
export type NewReferenceTone = typeof referenceTones.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserGear = typeof userGear.$inferSelect;
export type SavedTone = typeof savedTones.$inferSelect;
export type ResearchCacheRow = typeof researchCache.$inferSelect;
export type UsageLog = typeof usageLogs.$inferSelect;
export type FeedbackEvent = typeof feedbackEvents.$inferSelect;
export type GearExpansion = typeof gearExpansionQueue.$inferSelect;
export type ToneCandidate = typeof toneCandidates.$inferSelect;
export type NewToneCandidate = typeof toneCandidates.$inferInsert;
export type EvalHistoryRow = typeof evalHistory.$inferSelect;
export type RejectionLogRow = typeof rejectionLog.$inferSelect;
export type SystemFlag = typeof systemFlags.$inferSelect;
