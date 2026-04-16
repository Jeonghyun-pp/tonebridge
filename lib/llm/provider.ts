/**
 * Multi-provider LLM abstraction.
 *
 * Master plan §6.6.6 — Zero-Cost Track uses Gemini primary + Groq for
 * consensus. OpenAI is held as last-resort fallback.
 *
 * Each provider has slightly different JSON-mode semantics:
 *   Gemini  — native `responseSchema` (we convert via schema-compat)
 *   Groq    — `response_format: { type: "json_object" }` + schema embedded in system
 *   OpenAI  — `response_format: { type: "json_schema", json_schema: {...} }` non-strict
 *
 * Callers pass a raw JSON Schema; each provider adapts as needed.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toGeminiSchema } from "./schema-compat";

// =============================================================================
// Types
// =============================================================================
export type Provider = "gemini" | "groq" | "openai";

export interface CompletionInput {
  provider: Provider;
  system: string;
  user: string;
  /** Raw JSON Schema (zod-to-json-schema output). We adapt per provider internally. */
  schema: object;
  schemaName: string;
  temperature?: number;
  seed?: number;
}

export interface CompletionOutput<T> {
  data: T;
  provider: Provider;
  model: string;
  usage: { in: number; out: number };
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: "quota" | "rate_limit" | "schema" | "network" | "unknown",
    public readonly provider: Provider,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LLMError";
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Single completion against the specified provider.
 * Throws LLMError on known failure modes; validation is the caller's job.
 */
export async function complete<T>(input: CompletionInput): Promise<CompletionOutput<T>> {
  switch (input.provider) {
    case "gemini":
      return callGemini<T>(input);
    case "groq":
      return callGroq<T>(input);
    case "openai":
      return callOpenAI<T>(input);
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`Unknown provider: ${_exhaustive as string}`);
    }
  }
}

/**
 * Complete with automatic provider fallback:
 *   gemini  →  on quota/rate_limit, fall back to groq
 *   groq    →  on quota/rate_limit, fall back to openai (if key present)
 *   openai  →  no further fallback
 *
 * Other error kinds (schema, network, unknown) propagate.
 */
export async function completeWithFallback<T>(input: CompletionInput): Promise<CompletionOutput<T>> {
  try {
    return await complete<T>(input);
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    if (err.kind !== "quota" && err.kind !== "rate_limit") throw err;

    const next = nextProvider(input.provider);
    if (!next) throw err;
    if (next === "openai" && !process.env.OPENAI_API_KEY) throw err;

    console.warn(`[llm] ${input.provider} ${err.kind} — falling back to ${next}`);
    return complete<T>({ ...input, provider: next });
  }
}

function nextProvider(p: Provider): Provider | null {
  if (p === "gemini") return "groq";
  if (p === "groq") return "openai";
  return null;
}

/**
 * Convenience wrapper: pass a Zod schema, get typed + runtime-validated output.
 * Handles zodToJsonSchema conversion and MySchema.parse() in one step.
 */
export async function completeFromZod<Z extends ZodTypeAny>(args: {
  provider: Provider;
  system: string;
  user: string;
  schema: Z;
  schemaName: string;
  temperature?: number;
  seed?: number;
  withFallback?: boolean;
}): Promise<CompletionOutput<z.infer<Z>>> {
  // zod-to-json-schema@3 types target Zod v3; Zod v4's ZodType shape is compatible
  // at runtime but not typed. Cast once at the boundary.
  const jsonSchema = zodToJsonSchema(args.schema as never, {
    name: args.schemaName,
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;

  // zodToJsonSchema wraps output in {definitions: {Name: {...}}, $ref: "..."}
  // We want the inner schema directly.
  const unwrapped =
    jsonSchema.definitions && typeof jsonSchema.definitions === "object"
      ? (jsonSchema.definitions as Record<string, object>)[args.schemaName] ?? jsonSchema
      : jsonSchema;

  const input: CompletionInput = {
    provider: args.provider,
    system: args.system,
    user: args.user,
    schema: unwrapped,
    schemaName: args.schemaName,
    temperature: args.temperature,
    seed: args.seed,
  };

  const fn = args.withFallback ? completeWithFallback : complete;
  const result = await fn<unknown>(input);

  // Runtime validation — fail loudly if the LLM output deviates.
  const parsed = args.schema.parse(result.data) as z.infer<Z>;
  return { ...result, data: parsed };
}

// =============================================================================
// Gemini
// =============================================================================
async function callGemini<T>(i: CompletionInput): Promise<CompletionOutput<T>> {
  if (!process.env.GEMINI_API_KEY) {
    throw new LLMError("GEMINI_API_KEY missing", "unknown", "gemini");
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const geminiSchema = toGeminiSchema(i.schema);

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: i.system,
      generationConfig: {
        responseMimeType: "application/json",
        // The SDK types mark this as SchemaType-shaped; cast since we build it dynamically.
        responseSchema: geminiSchema as unknown as Parameters<
          typeof genAI.getGenerativeModel
        >[0]["generationConfig"] extends infer G
          ? G extends { responseSchema?: infer S }
            ? S
            : never
          : never,
        temperature: i.temperature ?? 0.3,
      },
    });

    const res = await model.generateContent(i.user);
    const text = res.response.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch (parseErr) {
      throw new LLMError(
        `Gemini returned non-JSON: ${text.slice(0, 200)}`,
        "schema",
        "gemini",
        parseErr
      );
    }
    const usage = res.response.usageMetadata;
    return {
      data,
      provider: "gemini",
      model: modelName,
      usage: { in: usage?.promptTokenCount ?? 0, out: usage?.candidatesTokenCount ?? 0 },
    };
  } catch (err) {
    if (err instanceof LLMError) throw err;
    throw classifyError(err, "gemini");
  }
}

// =============================================================================
// Groq (OpenAI-compatible REST)
// =============================================================================
async function callGroq<T>(i: CompletionInput): Promise<CompletionOutput<T>> {
  if (!process.env.GROQ_API_KEY) {
    throw new LLMError("GROQ_API_KEY missing", "unknown", "groq");
  }
  const modelName = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

  // Groq doesn't have a native schema mode — embed in system prompt.
  const augmentedSystem = `${i.system}

Respond with a single JSON object that conforms exactly to this schema. Do not wrap in markdown fences. Do not include any text outside the JSON.

Schema (${i.schemaName}):
${JSON.stringify(i.schema, null, 2)}`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: augmentedSystem },
          { role: "user", content: i.user },
        ],
        response_format: { type: "json_object" },
        temperature: i.temperature ?? 0.3,
        ...(i.seed !== undefined ? { seed: i.seed } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw classifyHttpError(res.status, body, "groq");
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = json.choices[0]?.message?.content ?? "";
    let data: T;
    try {
      data = JSON.parse(content) as T;
    } catch (parseErr) {
      throw new LLMError(
        `Groq returned non-JSON: ${content.slice(0, 200)}`,
        "schema",
        "groq",
        parseErr
      );
    }
    return {
      data,
      provider: "groq",
      model: modelName,
      usage: {
        in: json.usage?.prompt_tokens ?? 0,
        out: json.usage?.completion_tokens ?? 0,
      },
    };
  } catch (err) {
    if (err instanceof LLMError) throw err;
    throw classifyError(err, "groq");
  }
}

// =============================================================================
// OpenAI (fallback only)
// =============================================================================
async function callOpenAI<T>(i: CompletionInput): Promise<CompletionOutput<T>> {
  if (!process.env.OPENAI_API_KEY) {
    throw new LLMError("OPENAI_API_KEY missing", "unknown", "openai");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const modelName = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const res = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: i.system },
        { role: "user", content: i.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: i.schemaName,
          // strict: false — our schemas may contain patterns strict mode rejects
          // (missing `additionalProperties: false`, optional fields not in required, etc).
          // We rely on Zod validation for enforcement.
          strict: false,
          schema: i.schema as Record<string, unknown>,
        },
      },
      temperature: i.temperature ?? 0.3,
      ...(i.seed !== undefined ? { seed: i.seed } : {}),
    });

    const content = res.choices[0]?.message?.content ?? "";
    let data: T;
    try {
      data = JSON.parse(content) as T;
    } catch (parseErr) {
      throw new LLMError(
        `OpenAI returned non-JSON: ${content.slice(0, 200)}`,
        "schema",
        "openai",
        parseErr
      );
    }
    return {
      data,
      provider: "openai",
      model: res.model,
      usage: {
        in: res.usage?.prompt_tokens ?? 0,
        out: res.usage?.completion_tokens ?? 0,
      },
    };
  } catch (err) {
    if (err instanceof LLMError) throw err;
    throw classifyError(err, "openai");
  }
}

// =============================================================================
// Error classification
// =============================================================================
function classifyError(err: unknown, provider: Provider): LLMError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (/429|rate.?limit|too many/.test(lower)) {
    return new LLMError(msg, "rate_limit", provider, err);
  }
  if (/quota|exceed|limit reached|insufficient/.test(lower)) {
    return new LLMError(msg, "quota", provider, err);
  }
  if (/schema|json|parse/.test(lower)) {
    return new LLMError(msg, "schema", provider, err);
  }
  if (/network|fetch|econnreset|etimedout|socket/.test(lower)) {
    return new LLMError(msg, "network", provider, err);
  }
  return new LLMError(msg, "unknown", provider, err);
}

function classifyHttpError(status: number, body: string, provider: Provider): LLMError {
  const preview = body.slice(0, 200);
  if (status === 429) {
    // Distinguish quota vs rate-limit by body content where possible
    const kind: "quota" | "rate_limit" = /quota|daily|tokens per day|tpd/i.test(body)
      ? "quota"
      : "rate_limit";
    return new LLMError(`${provider} HTTP 429: ${preview}`, kind, provider);
  }
  if (status >= 500) {
    return new LLMError(`${provider} HTTP ${status}: ${preview}`, "network", provider);
  }
  return new LLMError(`${provider} HTTP ${status}: ${preview}`, "unknown", provider);
}

// =============================================================================
// Cost estimation (used by /api/research-tone usage_logs row)
// =============================================================================
const PRICING: Record<string, { in: number; out: number }> = {
  // per 1M tokens, USD
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
  "gpt-4o-2024-08-06": { in: 2.5, out: 10.0 },
  "gemini-1.5-flash": { in: 0, out: 0 }, // free tier
  "gemini-1.5-pro": { in: 1.25, out: 5.0 },
  "llama-3.3-70b-versatile": { in: 0, out: 0 }, // Groq free tier
};

export function estimateCostUsd(model: string, usage: { in: number; out: number }): number {
  const rate = PRICING[model];
  if (!rate) return 0;
  return (usage.in * rate.in + usage.out * rate.out) / 1_000_000;
}
