/**
 * robots.txt + rate-limit + identifying User-Agent compliant fetch.
 *
 * Master plan §10.1 · DATA-AUTOMATION §10.1.
 *
 * All raw-HTML fetches in the automation pipeline go through this module.
 * Goal: stay inside the "human in a browser" boundary so bulk extraction
 * doesn't violate publishers' ToS. See DATA-SOURCING-STRATEGY §1.
 *
 * Behavior:
 *   1. Caches robots.txt per hostname
 *   2. Refuses if robots disallows our User-Agent for the URL
 *   3. Per-domain serialization (one request at a time) with fixed delay
 *   4. 15s timeout per request
 *   5. Returns null (not throws) on any skip condition — caller filters
 *
 * NEVER returns the raw HTML unchanged to a DB write path — callers must
 * pass the text through LLM extraction first (see lib/automation/storage-guard).
 */
import pLimit from "p-limit";
import robotsParser, { type Robot } from "robots-parser";

const USER_AGENT =
  process.env.FETCH_USER_AGENT ??
  "ToneBridgeBot/1.0 (+https://tonebridge.app/bot; contact@tonebridge.app)";
const PER_DOMAIN_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 15_000;

const robotsCache = new Map<string, Robot>();
const perDomainLimit = new Map<string, ReturnType<typeof pLimit>>();

export interface FetchResult {
  url: string;
  status: number | null;        // null = network error / skipped
  contentType: string | null;
  text: string | null;
  skippedReason?: "robots" | "content-type" | "http-error" | "timeout" | "network" | "invalid-url";
}

async function loadRobots(origin: string, hostname: string): Promise<Robot> {
  const cached = robotsCache.get(hostname);
  if (cached) return cached;
  let body = "";
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) body = await res.text();
  } catch {
    // If robots.txt is unreachable, treat as permissive (empty body allows all).
  }
  const robot = robotsParser(`${origin}/robots.txt`, body);
  robotsCache.set(hostname, robot);
  return robot;
}

function getDomainLimit(hostname: string) {
  let l = perDomainLimit.get(hostname);
  if (!l) {
    l = pLimit(1);
    perDomainLimit.set(hostname, l);
  }
  return l;
}

/**
 * Fetch a single URL respecting robots.txt + per-domain rate limit.
 * Returns null text on any skip/error condition; never throws.
 */
export async function fetchWithGuard(url: string): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, status: null, contentType: null, text: null, skippedReason: "invalid-url" };
  }

  const robots = await loadRobots(parsed.origin, parsed.hostname);
  // robots-parser returns true | false | undefined; only `false` is an explicit block.
  if (robots.isAllowed(url, USER_AGENT) === false) {
    return { url, status: null, contentType: null, text: null, skippedReason: "robots" };
  }

  return getDomainLimit(parsed.hostname)(async () => {
    await new Promise((r) => setTimeout(r, PER_DOMAIN_DELAY_MS));

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json;q=0.9" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "follow",
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        return {
          url,
          status: res.status,
          contentType,
          text: null,
          skippedReason: "http-error",
        };
      }
      if (contentType && !/text\/html|application\/(json|xml|xhtml\+xml)/i.test(contentType)) {
        return {
          url,
          status: res.status,
          contentType,
          text: null,
          skippedReason: "content-type",
        };
      }
      const text = await res.text();
      return { url, status: res.status, contentType, text };
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      const reason: FetchResult["skippedReason"] = /timeout|abort/.test(msg) ? "timeout" : "network";
      return { url, status: null, contentType: null, text: null, skippedReason: reason };
    }
  });
}

/**
 * Parallel fetch across URLs, preserving per-domain serialization.
 * `maxGlobalConcurrency` caps the total number of fetches in flight regardless
 * of domain distribution — keeps CPU/memory in check during Tier A batches.
 */
export async function fetchAllWithGuard(
  urls: string[],
  maxGlobalConcurrency = 5
): Promise<FetchResult[]> {
  const globalLimit = pLimit(maxGlobalConcurrency);
  return Promise.all(urls.map((u) => globalLimit(() => fetchWithGuard(u))));
}

// =============================================================================
// HTML utilities (used by phase 0-3 to strip and extract text)
// =============================================================================

/** Minimal HTML→text conversion — drops scripts/styles, collapses whitespace. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pulls the text of a MediaWiki Parsoid section by its H2 id.
 * Returns null when the section is not found.
 *
 * Wikipedia HTML structure (Parsoid):
 *   <section data-mw-section-id="N">
 *     <h2 id="Equipment">Equipment</h2>
 *     <p>...</p>
 *   </section>
 *
 * We accept variations in id casing (replaces spaces with underscores).
 */
export function extractSection(html: string, sectionTitle: string): string | null {
  const idVariants = [
    sectionTitle,
    sectionTitle.replace(/ /g, "_"),
    sectionTitle.toLowerCase(),
    sectionTitle.toLowerCase().replace(/ /g, "_"),
  ];
  for (const id of idVariants) {
    // Match <h2 ... id="id" ...>...<h2 or end
    const rx = new RegExp(
      `<h2[^>]*id="${escapeRegExp(id)}"[^>]*>[\\s\\S]*?(?=<h2|<section\\s+data-mw-section-id|$)`,
      "i"
    );
    const m = html.match(rx);
    if (m) {
      const text = stripHtml(m[0]);
      if (text.length > 20) return text;
    }
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
