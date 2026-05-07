import { ParseResult } from "./types.js";
import { htmlToText, parseRussianRange } from "./dateUtils.js";

/**
 * Last-resort parser. Looks for keyword anchors ("проведения", "монтаж",
 * "демонтаж") and parses a Russian date range in the surrounding window.
 * Confidence is capped at 0.3 so the caller knows to require manual review.
 */
export function parseGeneric(html: string, url: string, host: string): ParseResult {
  const result: ParseResult = {
    confidence: 0,
    notes: [],
    url,
    host,
    parser: "generic",
  };
  const text = htmlToText(html);

  const event = sliceAround(text, /провед[её]ни[яе]/i);
  if (event) {
    const r = parseRussianRange(event);
    if (r.begin) result.beginDate = r.begin;
    if (r.end) result.endDate = r.end;
    if (r.begin || r.end) result.notes.push(`event~: ${event.slice(0, 60)}`);
  }
  if (!result.beginDate) {
    const r = parseRussianRange(text.slice(0, 4000));
    if (r.begin) result.beginDate = r.begin;
    if (r.end) result.endDate = r.end;
    if (r.begin || r.end) result.notes.push("event: top-of-page fallback");
  }

  const mount = sliceAround(text, /монтаж/i);
  if (mount) {
    const r = parseRussianRange(mount);
    if (r.begin) result.montageStart = r.begin;
    if (r.end) result.montageEnd = r.end;
    if (r.begin) result.notes.push(`mount~: ${mount.slice(0, 60)}`);
  }

  const dismantle = sliceAround(text, /демонтаж/i);
  if (dismantle) {
    const r = parseRussianRange(dismantle);
    if (r.begin) result.dismantleStart = r.begin;
    if (r.end) result.dismantleEnd = r.end;
    if (r.begin) result.notes.push(`dismantle~: ${dismantle.slice(0, 60)}`);
  }

  if (result.beginDate && result.endDate) result.confidence = 0.3;
  else if (result.beginDate) result.confidence = 0.2;

  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (og?.[1]) result.title = og[1].trim();
  else {
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (t?.[1]) result.title = t[1].trim();
  }
  return result;
}

function sliceAround(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const start = Math.max(0, m.index - 30);
  return text.slice(start, m.index + 200);
}
