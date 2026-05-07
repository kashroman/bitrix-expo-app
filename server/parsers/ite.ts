import { ParseResult } from "./types.js";
import { htmlToText, parseRussianRange, toIso } from "./dateUtils.js";

/**
 * Generic ITE-style parser for rosupack.com / neftegaz-expo.ru / mitt.ru /
 * intercharm.ru. These sites typically expose either a JSON-LD `Event`
 * schema or a "Часы работы" text block. We try JSON-LD first, then text.
 */
export function parseIte(html: string, url: string, host: string): ParseResult {
  const result: ParseResult = {
    confidence: 0,
    notes: [],
    url,
    host,
    parser: "ite",
  };

  const ld = extractJsonLdEvent(html);
  if (ld?.startDate) {
    const begin = isoFromAny(ld.startDate);
    const end = isoFromAny(ld.endDate ?? ld.startDate);
    if (begin) {
      result.beginDate = begin;
      result.endDate = end ?? begin;
      result.notes.push(`json-ld: ${begin}..${end ?? begin}`);
    }
    if (typeof ld.name === "string") result.title = ld.name;
    if (ld.location?.name) result.venue = String(ld.location.name);
  }

  if (!result.beginDate) {
    const text = htmlToText(html);
    const block =
      sliceAfter(text, ["Часы работы", "Сроки проведения", "Даты проведения"]) ??
      text.slice(0, 2000);
    const r = parseRussianRange(block);
    if (r.begin) result.beginDate = r.begin;
    if (r.end) result.endDate = r.end;
    if (r.begin || r.end) result.notes.push(`text: ${block.slice(0, 60)}`);
  }

  if (!result.title) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
    if (og?.[1]) result.title = og[1].trim();
    else {
      const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (t?.[1]) result.title = t[1].trim();
    }
  }

  if (result.beginDate && result.endDate) result.confidence = 0.7;
  else if (result.beginDate) result.confidence = 0.5;

  return result;
}

function sliceAfter(text: string, headings: string[]): string | undefined {
  for (const h of headings) {
    const idx = text.toLowerCase().indexOf(h.toLowerCase());
    if (idx >= 0) return text.slice(idx, idx + 200);
  }
  return undefined;
}

function extractJsonLdEvent(html: string): any | undefined {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        const items = c["@graph"] ?? [c];
        for (const item of items) {
          const t = item?.["@type"];
          if (t === "Event" || (Array.isArray(t) && t.includes("Event"))) {
            return item;
          }
        }
      }
    } catch {
      // continue — broken JSON-LD blocks are common.
    }
  }
  return undefined;
}

function isoFromAny(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return undefined;
}
