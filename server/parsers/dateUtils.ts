/**
 * Helpers for parsing Russian-language date phrases found on exhibition
 * organizer websites. All output dates are ISO `YYYY-MM-DD` strings.
 */

const RU_MONTHS: Record<string, number> = {
  январ: 1, "января": 1,
  феврал: 2, "февраля": 2,
  март: 3, "марта": 3,
  апрел: 4, "апреля": 4,
  май: 5, "мая": 5,
  июн: 6, "июня": 6,
  июл: 7, "июля": 7,
  август: 8, "августа": 8,
  сентябр: 9, "сентября": 9,
  октябр: 10, "октября": 10,
  ноябр: 11, "ноября": 11,
  декабр: 12, "декабря": 12,
};

/** Tolerant Russian month lookup — matches by leading stem. */
export function ruMonth(raw: string): number | undefined {
  const lower = raw.toLowerCase().replace(/[ёе]/g, "е");
  for (const [stem, num] of Object.entries(RU_MONTHS)) {
    if (lower.startsWith(stem)) return num;
  }
  return undefined;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Match `DD[—/–-]DD <month> YYYY` — both dashes and ranges allowed. Falls
 *  back to a single-day match `DD <month> YYYY`. Returns ISO begin/end. */
export function parseRussianRange(text: string): { begin?: string; end?: string } {
  const cleaned = text
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-");

  // Cross-month form first ("31 марта — 2 апреля 2026"), because it's more
  // specific. Otherwise an embedded same-month range elsewhere on the page
  // (e.g. "29—30 марта 2026" in the montage block) would steal the match.
  const crossMonth = cleaned.match(
    /(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\s*[-–—]\s*(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\s+(\d{4})/,
  );
  if (crossMonth) {
    const d1 = Number(crossMonth[1]);
    const m1 = ruMonth(crossMonth[2]);
    const d2 = Number(crossMonth[3]);
    const m2 = ruMonth(crossMonth[4]);
    const y = Number(crossMonth[5]);
    if (m1 && m2 && d1 && d2 && y) {
      return { begin: toIso(y, m1, d1), end: toIso(y, m2, d2) };
    }
  }

  const range = cleaned.match(
    /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\s+(\d{4})/,
  );
  if (range) {
    const d1 = Number(range[1]);
    const d2 = Number(range[2]);
    const m = ruMonth(range[3]);
    const y = Number(range[4]);
    if (m && d1 && d2 && y) {
      return { begin: toIso(y, m, d1), end: toIso(y, m, d2) };
    }
  }

  const single = cleaned.match(
    /(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\s+(\d{4})/,
  );
  if (single) {
    const d = Number(single[1]);
    const m = ruMonth(single[2]);
    const y = Number(single[3]);
    if (m && d && y) {
      const iso = toIso(y, m, d);
      return { begin: iso, end: iso };
    }
  }

  return {};
}

/** Strip HTML tags, decode common entities, collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&laquo;|&raquo;/gi, '"')
    .replace(/&quot;/gi, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
