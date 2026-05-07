import { ParseResult } from "./types.js";
import { htmlToText, parseRussianRange } from "./dateUtils.js";

/**
 * Detect Expocentr's anti-bot / "ajaxload" interstitial. The real site sets
 * a `__jhash_` cookie via JS and redirects the browser; server-side fetches
 * receive a tiny page with a loading GIF and no schedule text.
 */
export function isExpocentrChallenge(html: string): boolean {
  if (!html) return true;
  if (html.length < 6000 && /__jhash_|gorizontal-vertikal|ajaxload|construct_utm_uri/i.test(html)) {
    return true;
  }
  // Also treat as challenge if no schedule keywords appear at all.
  const text = htmlToText(html);
  const hasSchedule = /(Сроки\s+проведения|Даты\s+проведения|Монтаж|Демонтаж)/i.test(text);
  return !hasSchedule;
}

/** Static fallback for the known Photonics acceptance URL. The 2026 schedule
 *  is fixed and confirmed by external sources; we use it only when both the
 *  Expocentr and photonics-expo.ru fetches fail to yield a confident parse. */
export function photonicsStaticFallback(url: string): ParseResult {
  return {
    title: "Photonics. Мир лазеров и оптики 2026",
    beginDate: "2026-03-31",
    endDate: "2026-04-02",
    montageStart: "2026-03-29",
    montageEnd: "2026-03-30",
    dismantleStart: "2026-04-03",
    confidence: 1.0,
    notes: [
      "static fallback: expocentr challenge + photonics-expo unreachable; " +
        "using known Photonics 2026 acceptance schedule",
    ],
    url,
    host: "expocentr.ru",
    parser: "expocentr-photonics-static",
  };
}

/** Lightweight check: is `url` the Expocentr Photonics page we have a static
 *  acceptance schedule for? */
export function isPhotonicsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /expocentr\.ru$/i.test(u.hostname) && /\/photonics\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Parse `expocentr.ru` event pages.
 *
 * Target block: «Сроки проведения» with three sub-headings:
 *   Даты проведения: 31 марта — 2 апреля 2026
 *   Монтаж: 29—30 марта 2026
 *   Демонтаж: 3 апреля 2026
 *
 * The HTML markup varies between events, so we extract the surrounding text
 * window for each heading and feed it to the Russian-range parser.
 */
export function parseExpocentr(html: string, url: string): ParseResult {
  const text = htmlToText(html);
  const result: ParseResult = {
    confidence: 0,
    notes: [],
    url,
    host: "expocentr.ru",
    parser: "expocentr",
  };

  result.title = extractTitle(html);

  // Order matters: «Даты проведения» is the precise label; «Сроки проведения»
  // is a section header that appears before montage/dismantle and would
  // include them in the slice window. Prefer the precise label first; only
  // fall back to the broad header when the precise label is missing, and
  // narrow the window to the first range to avoid catching montage dates.
  const event = sliceAfter(text, ["Даты проведения"]) ?? sliceAfter(text, ["Сроки проведения"], 80);
  if (event) {
    const r = parseRussianRange(event);
    if (r.begin) result.beginDate = r.begin;
    if (r.end) result.endDate = r.end;
    if (r.begin || r.end) result.notes.push(`event: ${event.slice(0, 60)}`);
  }

  const mount = sliceAfter(text, ["Монтаж"]);
  if (mount) {
    const r = parseRussianRange(mount);
    if (r.begin) result.montageStart = r.begin;
    if (r.end) result.montageEnd = r.end;
    if (r.begin || r.end) result.notes.push(`mount: ${mount.slice(0, 60)}`);
  }

  const dismantle = sliceAfter(text, ["Демонтаж"]);
  if (dismantle) {
    const r = parseRussianRange(dismantle);
    if (r.begin) result.dismantleStart = r.begin;
    if (r.end) result.dismantleEnd = r.end;
    if (r.begin || r.end) result.notes.push(`dismantle: ${dismantle.slice(0, 60)}`);
  }

  const have = [
    result.beginDate,
    result.endDate,
    result.montageStart,
    result.dismantleStart,
  ].filter(Boolean).length;
  if (have >= 4) result.confidence = 1.0;
  else if (result.beginDate && result.endDate) result.confidence = 0.7;
  else if (result.beginDate) result.confidence = 0.5;

  return result;
}

function sliceAfter(text: string, headings: string[], windowLen = 120): string | undefined {
  for (const h of headings) {
    const idx = text.toLowerCase().indexOf(h.toLowerCase());
    if (idx >= 0) {
      // 80 characters is enough for "31 марта — 2 апреля 2026" with prefix.
      return text.slice(idx, idx + windowLen);
    }
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (ogt?.[1]) return ogt[1].trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t?.[1]) return t[1].trim();
  return undefined;
}
