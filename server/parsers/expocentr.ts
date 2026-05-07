import { ParseResult } from "./types.js";
import { htmlToText, parseRussianRange } from "./dateUtils.js";

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

  const event = sliceAfter(text, ["Даты проведения", "Сроки проведения"]);
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

function sliceAfter(text: string, headings: string[]): string | undefined {
  for (const h of headings) {
    const idx = text.toLowerCase().indexOf(h.toLowerCase());
    if (idx >= 0) {
      // 80 characters is enough for "31 марта — 2 апреля 2026" with prefix.
      return text.slice(idx, idx + 120);
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
