/**
 * Live Stage 2 — Adapt the original tone recipe to the user's rig.
 *
 * Master plan §7.3.
 *
 * Pulls the user's gear + the source amp profile from gear DB so we can
 * inject voicing notes into the LLM context — this is the lever Stage 2
 * quality hinges on (master plan §6.5.3 / §6.6 discussion).
 */
import { db } from "@/lib/db/client";
import { amps, guitars, pedals } from "@/lib/db/schema";
import { eq, inArray, sql, desc } from "drizzle-orm";
import { completeFromZod, estimateCostUsd } from "./provider";
import { AdaptToneSchema, type AdaptTone, type ResearchTone } from "./api-schemas";

const SYSTEM_PROMPT = `You are a guitar tone translator. Given an original tone recipe and a
user's different rig, translate the settings so the sonic result on the user's gear is as close
as possible.

Reasoning framework (use these in order):
1. PICKUP OUTPUT DIFFERENCE — if user's pickup output is lower than original (e.g. 180mV vs 350mV),
   you may need to push gain +1 or +2, OR add an OD pedal in front if the user has one.
2. AMP VOICING — match the EQ curve, not the numbers. Moving from a scooped-mid amp (e.g.
   Rectifier) to a midforward amp (e.g. Plexi) means REDUCE mid by 1-2 and increase presence.
3. GAIN STRUCTURE — some amps (Fender) run gain lower numerically but get more breakup from
   power tubes. Modelers (Helix/Kemper/Axe) are literal — numbers mean what they say.
4. PEDAL MAPPING — for each original pedal, find a user pedal whose category AND
   character_tags match. If no good match, list it in missing_pedals with a category
   recommendation.
5. If you raise/lower any value by more than 2 from the original, explain WHY in adaptation_notes.

Hard rules:
- All numeric values must stay 0-10.
- Never reference pedals the user does not own (those go to missing_pedals).
- Be specific in adaptation_notes — operator will use it to debug if results are off.`;

export interface AdaptToneInput {
  research: ResearchTone;
  userGuitarId: number | null;
  userAmpId: number | null;
  userMultiFxId: number | null;
  userPedalIds: number[];
  userTonePreference?: string;
}

export interface AdaptToneOutput {
  data: AdaptTone;
  usage: { in: number; out: number };
  costUsd: number;
  model: string;
  provider: string;
}

export async function adaptTone(input: AdaptToneInput): Promise<AdaptToneOutput> {
  const [userGuitar, userAmp, userMultiFx, userPedals, sourceAmp] = await Promise.all([
    input.userGuitarId
      ? db.select().from(guitars).where(eq(guitars.id, input.userGuitarId)).limit(1)
      : Promise.resolve([]),
    input.userAmpId
      ? db.select().from(amps).where(eq(amps.id, input.userAmpId)).limit(1)
      : Promise.resolve([]),
    input.userMultiFxId
      ? db.select().from(amps).where(eq(amps.id, input.userMultiFxId)).limit(1)
      : Promise.resolve([]),
    input.userPedalIds.length
      ? db.select().from(pedals).where(inArray(pedals.id, input.userPedalIds))
      : Promise.resolve([]),
    findSourceAmp(input.research.amp.brand, input.research.amp.model),
  ]);

  const context = buildContext(input, {
    userGuitar: userGuitar[0],
    userAmp: userAmp[0],
    userMultiFx: userMultiFx[0],
    userPedals,
    sourceAmp,
  });

  const res = await completeFromZod({
    provider: "gemini",
    system: SYSTEM_PROMPT,
    user: `Translate this tone:\n\n${JSON.stringify(context, null, 2)}`,
    schema: AdaptToneSchema,
    schemaName: "AdaptTone",
    temperature: 0.2,
    withFallback: true,
  });

  return {
    data: res.data,
    usage: res.usage,
    costUsd: estimateCostUsd(res.model, res.usage),
    model: res.model,
    provider: res.provider,
  };
}

// =============================================================================
// Context builder
// =============================================================================
type AmpRow = typeof amps.$inferSelect;
type GuitarRow = typeof guitars.$inferSelect;
type PedalRow = typeof pedals.$inferSelect;

function buildContext(
  input: AdaptToneInput,
  gear: {
    userGuitar?: GuitarRow;
    userAmp?: AmpRow;
    userMultiFx?: AmpRow;
    userPedals: PedalRow[];
    sourceAmp: AmpRow | null;
  }
) {
  const sourceAmpName = `${input.research.amp.brand ?? "unknown"} ${input.research.amp.model ?? ""}`.trim();

  return {
    source: {
      amp_profile: gear.sourceAmp
        ? {
            brand: gear.sourceAmp.brand,
            model: gear.sourceAmp.model,
            voicing: gear.sourceAmp.voicing,
            character_tags: gear.sourceAmp.characterTags,
            knob_notes: gear.sourceAmp.knobNotes,    // ★ the leverage
            clean_headroom: gear.sourceAmp.cleanHeadroom,
            is_modeler: gear.sourceAmp.isModeler,
          }
        : { raw_name: sourceAmpName, voicing: "unknown" },
      guitar: {
        pickup_config: input.research.guitar.pickup_config,
        pickup_choice: input.research.pickup_choice,
      },
      settings: input.research.settings,
      guitar_knobs: input.research.guitar_knob_settings,
      pedals: input.research.pedals,
    },
    user: {
      amp_profile: gear.userAmp
        ? {
            brand: gear.userAmp.brand,
            model: gear.userAmp.model,
            voicing: gear.userAmp.voicing,
            character_tags: gear.userAmp.characterTags,
            knob_notes: gear.userAmp.knobNotes,      // ★ the leverage
            knob_layout: gear.userAmp.knobLayout,
            clean_headroom: gear.userAmp.cleanHeadroom,
            is_modeler: gear.userAmp.isModeler,
          }
        : null,
      multi_fx_profile: gear.userMultiFx
        ? {
            brand: gear.userMultiFx.brand,
            model: gear.userMultiFx.model,
            voicing: gear.userMultiFx.voicing,
            character_tags: gear.userMultiFx.characterTags,
          }
        : null,
      guitar_profile: gear.userGuitar
        ? {
            brand: gear.userGuitar.brand,
            model: gear.userGuitar.model,
            pickup_config: gear.userGuitar.pickupConfig,
            pickup_output_mv: gear.userGuitar.pickupOutputMv,
            character_tags: gear.userGuitar.characterTags,
          }
        : null,
      pedals: gear.userPedals.map((p) => ({
        id: p.id,
        name: `${p.brand} ${p.model}`,
        category: p.category,
        subcategory: p.subcategory,
        character_tags: p.characterTags,
        typical_settings: p.typicalSettings,
      })),
      tone_preference: input.userTonePreference ?? null,
    },
  };
}

// =============================================================================
// Source amp fuzzy match
// =============================================================================
async function findSourceAmp(brand: string | null, model: string | null): Promise<AmpRow | null> {
  if (!brand || !model) return null;
  const q = `${brand} ${model}`;
  const rows = await db
    .select()
    .from(amps)
    .where(sql`similarity(${amps.brand} || ' ' || ${amps.model}, ${q}) > 0.4`)
    .orderBy(desc(sql`similarity(${amps.brand} || ' ' || ${amps.model}, ${q})`))
    .limit(1);
  return rows[0] ?? null;
}
