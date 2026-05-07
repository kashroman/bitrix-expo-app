import { ParseResult } from "./types.js";
import { htmlToText, parseRussianRange } from "./dateUtils.js";

/**
 * Crocus Expo events are organized by many tenant-organizers, so structured
 * markup is unreliable. We only attempt a Russian-text date extraction and
 * surface lower confidence so the operator knows to verify manually.
 */
export function parseCrocus(html: string, url: string): ParseResult {
  const result: ParseResult = {
    confidence: 0,
    notes: [],
    url,
    host: "crocus-expo.ru",
    parser: "crocus",
  };
  const text = htmlToText(html);
  const r = parseRussianRange(text);
  if (r.begin) result.beginDate = r.begin;
  if (r.end) result.endDate = r.end;
  if (r.begin && r.end) result.confidence = 0.5;
  else if (r.begin) result.confidence = 0.3;
  result.notes.push("crocus: structured fields not available, fallback");

  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (og?.[1]) result.title = og[1].trim();
  return result;
}
