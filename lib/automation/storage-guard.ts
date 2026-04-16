/**
 * Runtime guard: refuse to write raw article HTML/text into the DB.
 *
 * DATA-AUTOMATION §10.2. Facts are free to store; expression is not.
 * This helper is called at every reference_tones / tone_candidates
 * / rejection_log insert site so that a bug in upstream extraction
 * can't cause a ToS violation.
 *
 * It throws loudly rather than logs — we want a failed test or 500
 * in dev, not a silent corpus-ingestion.
 */

const FORBIDDEN_KEYS = new Set([
  "html",
  "raw_text",
  "raw_html",
  "body",
  "content",
  "page_text",
  "snippet_full",
  "article_text",
]);

const ALLOWED_LONG_STRING_KEYS = new Set([
  "extraction_notes",
  "song_context",
  "tone_description",
  "knob_notes",       // gear DB - intentionally long
  "reason",
  "comment",
  "adaptation_notes",
  "purpose",
  "timing",
]);

const LONG_STRING_THRESHOLD = 500;

/**
 * Recursively scan any object being persisted to DB. Throws with the first
 * offending path. No-op in production unless ASSERT_STORAGE_GUARD=1 is set —
 * the check is O(n) across JSONB so we keep it opt-in at runtime but enabled
 * by default in dev/test.
 */
export function assertNoRawContent(obj: unknown, path = "$"): void {
  if (!shouldRun()) return;
  walk(obj, path);
}

function shouldRun(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ASSERT_STORAGE_GUARD === "1";
}

function walk(node: unknown, path: string): void {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;
  if (node instanceof Date) return;

  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    const childPath = `${path}.${key}`;

    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(
        `[storage-guard] forbidden field "${childPath}" — raw source text must not be persisted`
      );
    }

    if (
      typeof value === "string" &&
      value.length > LONG_STRING_THRESHOLD &&
      !ALLOWED_LONG_STRING_KEYS.has(key)
    ) {
      throw new Error(
        `[storage-guard] suspiciously long string at "${childPath}" ` +
          `(${value.length} chars) — raw source text leak? ` +
          `If this is intentional, add "${key}" to ALLOWED_LONG_STRING_KEYS.`
      );
    }

    walk(value, childPath);
  }
}
