/**
 * Seed gear DB from JSON data files.
 *
 *   npm run seed:gear
 *
 * Idempotent — uses ON CONFLICT (brand, model) DO UPDATE so re-running
 * picks up edits to character_tags / knob_notes / popularity without
 * touching the SERIAL id.
 *
 * MVP size (S7):
 *   guitars  ~50  popular instruments most users will own
 *   amps     ~30  Tier S 15 with full knob_notes + Tier A + 5 modelers
 *   pedals   ~60  covering 12+ categories
 *
 * Expand to full sizes (300/200/400) post-launch as gear_expansion_queue
 * surfaces real demand.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";
import { guitars, amps, pedals, type NewGuitar, type NewAmp, type NewPedal } from "@/lib/db/schema";

const DATA_DIR = path.join(process.cwd(), "scripts/seed/data");

interface RawGuitar {
  brand: string;
  model: string;
  pickup_config?: string;
  pickup_output_mv?: number;
  body_wood?: string;
  scale_length_in?: number;
  character_tags?: string[];
  aliases?: string[];
  popularity?: number;
}

interface RawAmp {
  brand: string;
  model: string;
  voicing?: string;
  character_tags?: string[];
  watts?: number;
  clean_headroom?: string;
  knob_layout?: Record<string, boolean | string[]>;
  knob_notes?: string;
  typical_genres?: string[];
  is_modeler?: boolean;
  aliases?: string[];
  popularity?: number;
}

interface RawPedal {
  brand: string;
  model: string;
  category: string;
  subcategory?: string;
  character_tags?: string[];
  typical_settings?: Record<string, string>;
  aliases?: string[];
  popularity?: number;
}

async function seedGuitars() {
  const file = path.join(DATA_DIR, "guitars.json");
  if (!fs.existsSync(file)) { console.warn(`[seed] missing ${file}`); return 0; }
  const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as RawGuitar[];

  for (const r of rows) {
    const v: NewGuitar = {
      brand: r.brand,
      model: r.model,
      pickupConfig: r.pickup_config ?? null,
      pickupOutputMv: r.pickup_output_mv ?? null,
      bodyWood: r.body_wood ?? null,
      scaleLengthIn: r.scale_length_in?.toString() ?? null,
      characterTags: r.character_tags ?? [],
      aliases: r.aliases ?? [],
      popularity: r.popularity ?? 0,
    };
    await db.insert(guitars).values(v).onConflictDoUpdate({
      target: [guitars.brand, guitars.model],
      set: {
        pickupConfig: v.pickupConfig,
        pickupOutputMv: v.pickupOutputMv,
        bodyWood: v.bodyWood,
        scaleLengthIn: v.scaleLengthIn,
        characterTags: v.characterTags,
        aliases: v.aliases,
        popularity: v.popularity,
      },
    });
  }
  return rows.length;
}

async function seedAmps() {
  const file = path.join(DATA_DIR, "amps.json");
  if (!fs.existsSync(file)) { console.warn(`[seed] missing ${file}`); return 0; }
  const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as RawAmp[];

  for (const r of rows) {
    const v: NewAmp = {
      brand: r.brand,
      model: r.model,
      voicing: r.voicing ?? null,
      characterTags: r.character_tags ?? [],
      watts: r.watts ?? null,
      cleanHeadroom: r.clean_headroom ?? null,
      knobLayout: r.knob_layout ?? null,
      knobNotes: r.knob_notes ?? null,
      typicalGenres: r.typical_genres ?? [],
      isModeler: r.is_modeler ?? false,
      aliases: r.aliases ?? [],
      popularity: r.popularity ?? 0,
    };
    await db.insert(amps).values(v).onConflictDoUpdate({
      target: [amps.brand, amps.model],
      set: {
        voicing: v.voicing,
        characterTags: v.characterTags,
        watts: v.watts,
        cleanHeadroom: v.cleanHeadroom,
        knobLayout: v.knobLayout,
        knobNotes: v.knobNotes,
        typicalGenres: v.typicalGenres,
        isModeler: v.isModeler,
        aliases: v.aliases,
        popularity: v.popularity,
      },
    });
  }
  return rows.length;
}

async function seedPedals() {
  const file = path.join(DATA_DIR, "pedals.json");
  if (!fs.existsSync(file)) { console.warn(`[seed] missing ${file}`); return 0; }
  const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as RawPedal[];

  for (const r of rows) {
    const v: NewPedal = {
      brand: r.brand,
      model: r.model,
      category: r.category,
      subcategory: r.subcategory ?? null,
      characterTags: r.character_tags ?? [],
      typicalSettings: r.typical_settings ?? null,
      aliases: r.aliases ?? [],
      popularity: r.popularity ?? 0,
    };
    await db.insert(pedals).values(v).onConflictDoUpdate({
      target: [pedals.brand, pedals.model],
      set: {
        category: v.category,
        subcategory: v.subcategory,
        characterTags: v.characterTags,
        typicalSettings: v.typicalSettings,
        aliases: v.aliases,
        popularity: v.popularity,
      },
    });
  }
  return rows.length;
}

async function main() {
  const [g, a, p] = await Promise.all([seedGuitars(), seedAmps(), seedPedals()]);
  console.log(`✅ seeded — ${g} guitars, ${a} amps, ${p} pedals`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed] failed:", e);
  process.exit(1);
});
