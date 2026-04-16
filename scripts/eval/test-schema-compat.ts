/**
 * Sanity test for schema-compat.ts — runnable without any API keys.
 *
 *   npx tsx scripts/eval/test-schema-compat.ts
 *
 * Exits with code 1 on any assertion failure.
 */
import { toGeminiSchema } from "../../lib/llm/schema-compat";

let failures = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assertEq<T>(actual: T, expected: T, label?: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${label ?? "assertEq"}\n    actual:   ${a}\n    expected: ${b}`);
  }
}

console.log("schema-compat");

test("simple object passes through", () => {
  const out = toGeminiSchema({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });
  assertEq(out, {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });
});

test("type array with null becomes nullable", () => {
  const out = toGeminiSchema({ type: ["string", "null"] });
  assertEq(out, { type: "string", nullable: true });
});

test("anyOf with null variant collapses to nullable", () => {
  const out = toGeminiSchema({
    anyOf: [{ type: "string" }, { type: "null" }],
  });
  assertEq(out, { type: "string", nullable: true });
});

test("strips additionalProperties, $schema, $id, format, const, default", () => {
  const out = toGeminiSchema({
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "MySchema",
    type: "object",
    additionalProperties: false,
    properties: {
      when: { type: "string", format: "date-time" },
      kind: { type: "string", const: "X" },
      size: { type: "number", default: 10 },
    },
  });
  assertEq(out, {
    type: "object",
    properties: {
      when: { type: "string" },
      kind: { type: "string" },
      size: { type: "number" },
    },
  });
});

test("nested objects recurse", () => {
  const out = toGeminiSchema({
    type: "object",
    properties: {
      inner: {
        type: "object",
        properties: { flag: { type: ["boolean", "null"] } },
      },
    },
  });
  assertEq(out, {
    type: "object",
    properties: {
      inner: {
        type: "object",
        properties: { flag: { type: "boolean", nullable: true } },
      },
    },
  });
});

test("arrays preserve items + constraints", () => {
  const out = toGeminiSchema({
    type: "array",
    items: { type: "string", enum: ["a", "b"] },
    minItems: 1,
    maxItems: 10,
  });
  assertEq(out, {
    type: "array",
    items: { type: "string", enum: ["a", "b"] },
    minItems: 1,
    maxItems: 10,
  });
});

test("oneOf picks first option (lossy but survives)", () => {
  const out = toGeminiSchema(
    {
      oneOf: [{ type: "string" }, { type: "number" }],
    },
    { warn: false }
  );
  assertEq(out, { type: "string" });
});

test("allOf merges keys", () => {
  const out = toGeminiSchema(
    {
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "number" } } },
      ],
    },
    { warn: false }
  );
  assertEq(out.type, "object");
  // properties merge (second wins on conflict, but these don't conflict)
  assertEq(Object.keys(out.properties as object).sort(), ["a", "b"]);
});

test("numeric constraints preserved", () => {
  const out = toGeminiSchema({
    type: "number",
    minimum: 0,
    maximum: 10,
  });
  assertEq(out, { type: "number", minimum: 0, maximum: 10 });
});

test("enum preserved on nullable string (Zod .enum().nullable())", () => {
  const out = toGeminiSchema({
    anyOf: [{ type: "string", enum: ["a", "b", "c"] }, { type: "null" }],
  });
  assertEq(out, { type: "string", enum: ["a", "b", "c"], nullable: true });
});

console.log(failures === 0 ? "\n✅ all passed" : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
