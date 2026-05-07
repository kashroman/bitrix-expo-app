import { ParseResult } from "./types.js";
import { htmlToText, parseRussianRange, ruMonth, toIso } from "./dateUtils.js";

/**
 * Parser for `photonics-expo.ru`, the Expocentr-operated micro-site for the
 * Photonics exhibition. Used as a fallback when the main expocentr.ru page
 * returns its anti-bot interstitial.
 *
 * The participants page (/ru/participants/) advertises the event in two
 * shapes: a body sentence ("...пройдет 31 марта – 2 апреля 2026 года...")
 * and Bootstrap "card" headers labelled Монтаж / Работа выставки / Демонтаж
 * with date ranges that often lack a year.
 */
export function parsePhotonicsExpo(html: string, url: string): ParseResult {
  const text = htmlToText(html);
  const result: ParseResult = {
    confidence: 0,
    notes: [],
    url,
    host: "photonics-expo.ru",
    parser: "photonics-expo",
  };

  result.title = extractTitle(html);

  // Body sentence is the most authoritative event-date source:
  // "пройдет 31 марта – 2 апреля 2026 года".
  const eventSentence = text.match(
    /пройд[её]т[^.]{0,80}?(\d{1,2}\s+[A-Za-zА-Яа-яЁё]+\s*[-–—]\s*\d{1,2}\s+[A-Za-zА-Яа-яЁё]+\s+\d{4})/i,
  );
  let year: number | undefined;
  if (eventSentence) {
    const r = parseRussianRange(eventSentence[1]);
    if (r.begin) {
      result.beginDate = r.begin;
      year = Number(r.begin.slice(0, 4));
    }
    if (r.end) result.endDate = r.end;
    if (r.begin || r.end) result.notes.push(`event: ${eventSentence[1].slice(0, 60)}`);
  }

  const mountWindow = sliceLabelWindow(text, "Монтаж");
  if (mountWindow) {
    const r = parseRangeWithYear(mountWindow, year);
    if (r.begin) result.montageStart = r.begin;
    if (r.end) result.montageEnd = r.end;
    if (r.begin || r.end) result.notes.push(`mount: ${mountWindow.slice(0, 60)}`);
  }

  const dismantleWindow = sliceLabelWindow(text, "Демонтаж");
  if (dismantleWindow) {
    const r = parseRangeWithYear(dismantleWindow, year);
    if (r.begin) result.dismantleStart = r.begin;
    if (r.end) result.dismantleEnd = r.end;
    if (r.begin || r.end) result.notes.push(`dismantle: ${dismantleWindow.slice(0, 60)}`);
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

function sliceLabelWindow(text: string, label: string): string | undefined {
  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  if (idx < 0) return undefined;
  return text.slice(idx, idx + 200);
}

/** Like parseRussianRange but tolerates ranges without a year by injecting
 *  the event year extracted earlier on the page. */
function parseRangeWithYear(text: string, year: number | undefined): { begin?: string; end?: string } {
  const direct = parseRussianRange(text);
  if (direct.begin) return direct;
  if (!year) return {};

  const cleaned = text
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-");

  const cross = cleaned.match(
    /(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\s*[-–—]\s*(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)(?!\s+\d{4})/,
  );
  if (cross) {
    const m1 = ruMonth(cross[2]);
    const m2 = ruMonth(cross[4]);
    if (m1 && m2) return { begin: toIso(year, m1, Number(cross[1])), end: toIso(year, m2, Number(cross[3])) };
  }

  const same = cleaned.match(
    /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)(?!\s+\d{4})/,
  );
  if (same) {
    const m = ruMonth(same[3]);
    if (m) return { begin: toIso(year, m, Number(same[1])), end: toIso(year, m, Number(same[2])) };
  }

  const single = cleaned.match(/(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)(?!\s+\d{4})/);
  if (single) {
    const m = ruMonth(single[2]);
    if (m) {
      const iso = toIso(year, m, Number(single[1]));
      return { begin: iso, end: iso };
    }
  }

  return {};
}

function extractTitle(html: string): string | undefined {
  const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (ogt?.[1]) return ogt[1].trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t?.[1]) return t[1].trim();
  return undefined;
}
