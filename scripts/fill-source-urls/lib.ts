/**
 * Pure helpers for fill-source-urls. Kept side-effect free so they can be
 * unit tested without network/Bitrix access.
 */

export const ENTITY_TYPE_ID = 1050;

export const SOURCE_FIELD_KEYS = {
  url: ["ufCrm8SourceUrl", "UF_CRM_8_SOURCE_URL"],
  lastChecked: ["ufCrm8LastChecked", "UF_CRM_8_LAST_CHECKED"],
  parseLog: ["ufCrm8ParseLog", "UF_CRM_8_PARSE_LOG"],
} as const;

export type Candidate = {
  url: string;
  domain: string;
  snippet: string;
  snippetTitle: string;
};

export type ScoredCandidate = Candidate & { score: number };

const STOP_WORDS = new Set([
  "выставка",
  "выставке",
  "выставки",
  "международная",
  "международной",
  "международный",
  "exhibition",
  "expo",
  "fair",
  "show",
  "and",
  "the",
  "of",
  "for",
  "по",
  "на",
  "в",
  "и",
  "the",
]);

export function normalizeTitleTokens(title: string): string[] {
  if (!title) return [];
  const cleaned = title
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function buildSearchQueries(
  title: string,
  year: number | undefined,
): string[] {
  const t = title.trim();
  if (!t) return [];
  const queries: string[] = [];
  if (year) {
    queries.push(`${t} ${year} официальный сайт`);
    queries.push(`${t} ${year} site`);
  }
  queries.push(`${t} официальный сайт`);
  queries.push(`${t} выставка официальный сайт`);
  // De-duplicate while preserving order.
  return Array.from(new Set(queries));
}

/**
 * Aggregators / directories / social networks. Candidates whose domain
 * matches these are penalised heavily; they rarely point to the real
 * organiser site.
 */
const BAD_DOMAINS = [
  "expomap.ru",
  "expoclub.ru",
  "10times.com",
  "all-events.ru",
  "allexpo.ru",
  "exponet.ru",
  "vk.com",
  "vk.ru",
  "facebook.com",
  "instagram.com",
  "ok.ru",
  "t.me",
  "telegram.me",
  "yandex.ru",
  "maps.yandex.ru",
  "google.com",
  "google.ru",
  "wikipedia.org",
  "wiki",
  "tripadvisor.com",
  "youtube.com",
  "rutube.ru",
  "zen.yandex.ru",
  "dzen.ru",
  "afisha.ru",
  "kudago.com",
  "tass.ru",
  "rbc.ru",
  "kommersant.ru",
];

/**
 * Domains/keywords known to host official Russian exhibition sites. A small
 * curated list — the broader scoring still relies on token overlap, but a
 * match here adds a strong positive signal.
 */
const KNOWN_OFFICIAL_DOMAINS: { match: RegExp; boost: number }[] = [
  { match: /(^|\.)expocentr\.ru$/, boost: 0.35 },
  { match: /(^|\.)crocus-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)crocusexpo\.ru$/, boost: 0.35 },
  { match: /(^|\.)rosupack\.com$/, boost: 0.35 },
  { match: /(^|\.)mitt\.ru$/, boost: 0.35 },
  { match: /(^|\.)intercharm\.ru$/, boost: 0.35 },
  { match: /(^|\.)neftegaz-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)photonics-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)ite-expo\.ru$/, boost: 0.3 },
  { match: /(^|\.)ite-russia\.ru$/, boost: 0.3 },
  { match: /(^|\.)hyve\.group$/, boost: 0.2 },
  { match: /(^|\.)expoforum\.ru$/, boost: 0.3 },
];

function domainPenalty(domain: string): number {
  if (!domain) return -0.4;
  for (const bad of BAD_DOMAINS) {
    if (domain === bad || domain.endsWith(`.${bad}`)) return -0.6;
  }
  return 0;
}

function knownBoost(domain: string): number {
  if (!domain) return 0;
  for (const k of KNOWN_OFFICIAL_DOMAINS) {
    if (k.match.test(domain)) return k.boost;
  }
  return 0;
}

const OFFICIAL_HINTS = [
  "официальный",
  "official",
  "expo",
  "ru",
  "fair",
  "forum",
  "salon",
];

export function scoreCandidate(
  cand: Candidate,
  titleTokens: string[],
  year: number | undefined,
): number {
  const { domain, url, snippet, snippetTitle } = cand;
  if (!url) return 0;
  let score = 0.35; // base prior — we got *some* hit at all

  // Strong penalties first.
  score += domainPenalty(domain);
  score += knownBoost(domain);

  const fullText =
    `${domain} ${url} ${snippet} ${snippetTitle}`.toLowerCase();

  if (titleTokens.length) {
    let matched = 0;
    for (const tok of titleTokens) {
      if (fullText.includes(tok)) matched++;
    }
    const ratio = matched / titleTokens.length;
    score += ratio * 0.35;
    // domain itself includes a primary token → extra boost
    const primaryTokens = titleTokens.slice(0, 3);
    for (const tok of primaryTokens) {
      if (tok.length >= 4 && domain.includes(tok)) {
        score += 0.1;
        break;
      }
    }
  }

  if (year && fullText.includes(String(year))) score += 0.1;

  // .ru / official-looking hints
  if (/\.ru(\/|$)/.test(url) || /\.ru$/.test(domain)) score += 0.05;
  for (const hint of OFFICIAL_HINTS) {
    if (snippetTitle.toLowerCase().includes(hint)) {
      score += 0.03;
      break;
    }
  }

  // Avoid PDFs / news article URLs heuristically
  if (/\.pdf($|\?)/i.test(url)) score -= 0.2;
  if (/\/news\/|\/article\/|\/blog\//i.test(url)) score -= 0.15;

  // Clamp
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Number(score.toFixed(3));
}

export function pickBestCandidate(
  candidates: Candidate[],
  titleTokens: string[],
  year: number | undefined,
): ScoredCandidate | undefined {
  if (!candidates.length) return undefined;
  const scored: ScoredCandidate[] = candidates.map((c) => ({
    ...c,
    score: scoreCandidate(c, titleTokens, year),
  }));
  // Prefer higher score, then shorter URL (closer to root).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.url.length - b.url.length;
  });
  return scored[0];
}

/**
 * Parse DuckDuckGo HTML result page. The HTML endpoint wraps results in
 * `<a class="result__a" href="…">` blocks; the href is a redirect prefixed
 * with `//duckduckgo.com/l/?uddg=`. We resolve back to the original URL.
 */
export function extractDdgResults(
  html: string,
): { url: string; title: string; snippet: string }[] {
  if (!html) return [];
  const out: { url: string; title: string; snippet: string }[] = [];
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const rawHref = m[1];
    const rawTitle = stripTags(m[2]);
    const tail = m[3] ?? "";
    const snippetMatch = tail.match(
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
    const url = resolveDdgHref(rawHref);
    if (!url) continue;
    out.push({ url, title: rawTitle, snippet });
    if (out.length >= 20) break;
  }
  return out;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveDdgHref(href: string): string {
  if (!href) return "";
  let h = href.trim();
  if (h.startsWith("//")) h = `https:${h}`;
  try {
    const u = new URL(h);
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) {
      const uddg = u.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    return "";
  }
  return "";
}

/**
 * Returns true if eventEnd (ISO date or datetime string) is on or after today.
 * Defensive: returns false on missing/invalid input so we never accidentally
 * update past or undated items.
 */
export function isFutureExhibition(
  eventEndIso: string | null | undefined,
  todayIso: string,
): boolean {
  if (!eventEndIso || typeof eventEndIso !== "string") return false;
  const datePart = eventEndIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
  return datePart >= todayIso;
}

/**
 * Append a parse-log line, keeping only the last `max` lines so the userfield
 * does not grow unbounded.
 */
export function appendParseLogLine(
  existing: string,
  line: string,
  max = 10,
): string {
  const lines = (existing ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  lines.push(line);
  const tail = lines.slice(-max);
  return tail.join("\n");
}
