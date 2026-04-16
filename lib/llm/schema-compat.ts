/**
 * Schema compatibility layer.
 *
 * Gemini 1.5 Flash's `responseSchema` accepts only a subset of JSON Schema —
 * no `anyOf`, `oneOf`, `$ref`, `additionalProperties`, `patternProperties`.
 * This utility flattens a standard JSON Schema (e.g. from zod-to-json-schema)
 * to the Gemini subset.
 *
 * Groq and OpenAI work with the raw JSON Schema, so we only convert when
 * the target is Gemini.
 *
 * Common transformations:
 * - `type: ["string", "null"]`  →  `type: "string", nullable: true`
 * - `anyOf: [X, {type:"null"}]` →  `...X, nullable: true`  (Zod `.nullable()` pattern)
 * - `anyOf: [A, B, ...]`        →  first option (lossy — warned once per schema)
 * - `oneOf`, `allOf`             →  first option (lossy)
 * - `$ref`                       →  assumed inlined already (use `$refStrategy: "none"`)
 * - drops: `additionalProperties`, `patternProperties`, `$schema`, `definitions`,
 *   `format`, `const`, `default`
 */

type JsonSchema = Record<string, unknown> & { type?: string | string[] };

const STRIP_KEYS = new Set([
  "additionalProperties",
  "patternProperties",
  "$schema",
  "$id",
  "$ref",
  "definitions",
  "$defs",
  "format",
  "const",
  "default",
  "examples",
  "title",
  "readOnly",
  "writeOnly",
]);

const PRESERVED_KEYS = new Set([
  "type",
  "properties",
  "items",
  "required",
  "enum",
  "description",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "nullable",
]);

interface ConvertOptions {
  /** Warn on lossy conversions (anyOf with >2 options, etc). Default: true in dev */
  warn?: boolean;
}

/**
 * Convert a JSON Schema to a Gemini-compatible schema.
 *
 * Does NOT uppercase types — Gemini SDK accepts both lowercase and uppercase.
 * If you need uppercase, post-process with `uppercaseTypes()`.
 */
export function toGeminiSchema(schema: unknown, opts: ConvertOptions = {}): JsonSchema {
  const warn = opts.warn ?? process.env.NODE_ENV !== "production";
  return convertNode(schema, warn);
}

function convertNode(node: unknown, warn: boolean): JsonSchema {
  if (node === null || node === undefined) return {};
  if (typeof node !== "object") return {};
  if (Array.isArray(node)) {
    // Unusual — shouldn't happen at schema root, but handle gracefully
    return convertNode(node[0], warn);
  }

  const n = node as JsonSchema;

  // Step 1: Resolve anyOf/oneOf/allOf
  if (Array.isArray(n.anyOf)) {
    return resolveUnion("anyOf", n.anyOf as unknown[], warn);
  }
  if (Array.isArray(n.oneOf)) {
    return resolveUnion("oneOf", n.oneOf as unknown[], warn);
  }
  if (Array.isArray(n.allOf)) {
    return mergeAllOf(n.allOf as unknown[], warn);
  }

  // Step 2: Handle multi-type (["string","null"])
  const out: JsonSchema = {};
  if (Array.isArray(n.type)) {
    const types = n.type as string[];
    const hasNull = types.includes("null");
    const others = types.filter((t) => t !== "null");
    if (others.length === 1) {
      out.type = others[0];
      if (hasNull) out.nullable = true;
    } else if (others.length > 1) {
      if (warn) {
        console.warn(
          `[schema-compat] type array with multiple non-null types is lossy; picked "${others[0]}"`
        );
      }
      out.type = others[0];
      if (hasNull) out.nullable = true;
    }
  } else if (typeof n.type === "string") {
    out.type = n.type;
  }

  // Step 3: Recurse into known container keys
  if (n.properties && typeof n.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(n.properties as Record<string, unknown>).map(([k, v]) => [k, convertNode(v, warn)])
    );
  }
  if (n.items !== undefined) {
    out.items = convertNode(n.items, warn);
  }

  // Step 4: Copy preserved primitives
  for (const key of Object.keys(n)) {
    if (!PRESERVED_KEYS.has(key)) continue;
    if (key === "type" || key === "properties" || key === "items") continue; // handled
    out[key] = n[key];
  }

  // Step 5: Silently drop unsupported (STRIP_KEYS, $ref, etc.)
  return out;
}

function mergeAllOf(parts: unknown[], warn: boolean): JsonSchema {
  const merged: JsonSchema = {};
  for (const raw of parts) {
    const part = convertNode(raw, warn);
    for (const [k, v] of Object.entries(part)) {
      if (
        k === "properties" &&
        typeof merged.properties === "object" &&
        merged.properties !== null &&
        typeof v === "object" &&
        v !== null
      ) {
        merged.properties = { ...(merged.properties as object), ...(v as object) };
      } else if (k === "required" && Array.isArray(merged.required) && Array.isArray(v)) {
        merged.required = Array.from(new Set([...(merged.required as string[]), ...(v as string[])]));
      } else {
        (merged as Record<string, unknown>)[k] = v;
      }
    }
  }
  return merged;
}

function resolveUnion(kind: "anyOf" | "oneOf", options: unknown[], warn: boolean): JsonSchema {
  // Recognize the common Zod ".nullable()" pattern: [T, {type: "null"}]
  const optsAsNodes = options.map((o) => (o && typeof o === "object" ? (o as JsonSchema) : {}));
  const nullOpt = optsAsNodes.find((o) => o.type === "null");
  const nonNullOpts = optsAsNodes.filter((o) => o.type !== "null");

  if (nullOpt && nonNullOpts.length === 1) {
    const converted = convertNode(nonNullOpts[0], warn);
    return { ...converted, nullable: true };
  }

  if (warn && nonNullOpts.length > 1) {
    console.warn(
      `[schema-compat] ${kind} with ${nonNullOpts.length} non-null options is lossy; picked first`
    );
  }

  const first = convertNode(nonNullOpts[0] ?? optsAsNodes[0] ?? {}, warn);
  if (nullOpt) (first as JsonSchema).nullable = true;
  return first;
}

/**
 * Post-process a schema to use UPPERCASE type values (OpenAPI/Gemini REST style).
 * The @google/generative-ai SDK accepts lowercase, so this is usually unnecessary.
 */
export function uppercaseTypes(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== "object") return schema;
  const out: JsonSchema = { ...schema };
  if (typeof out.type === "string") out.type = out.type.toUpperCase();
  if (out.properties && typeof out.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(out.properties as Record<string, JsonSchema>).map(([k, v]) => [
        k,
        uppercaseTypes(v),
      ])
    );
  }
  if (out.items) out.items = uppercaseTypes(out.items as JsonSchema);
  return out;
}
