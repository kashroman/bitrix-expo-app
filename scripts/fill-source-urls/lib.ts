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

export type ScoredCandidate = Candidate & {
  score: number;
  aggregator: boolean;
};

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
 * Aggregators, exhibition directories, ticket marketplaces, social networks,
 * mass-media and tag/news pages. Any candidate whose host (or registrable
 * parent) matches this list is treated as an *aggregator*: heavily penalised
 * in scoring and, in apply mode, hard-skipped via the `skippedAggregator`
 * status. Listing here is deliberately broad — false positives just mean
 * "wait for a better candidate", false negatives mean writing junk to CRM.
 */
export const AGGREGATOR_DOMAINS = [
  // Russian exhibition aggregators / directories
  "expomap.ru",
  "expoclub.ru",
  "expo77.ru",
  "ict2go.ru",
  "totalexpo.ru",
  "exponet.ru",
  "expotime.ru",
  "proexpo.ru",
  "expocentr-online.ru",
  "all-events.ru",
  "allexpo.ru",
  "vystavki.ru",
  "expo-russia.ru",
  "expolife.ru",
  "expopromoter.com",
  "tradefairdates.com",
  "neftegaz.ru",
  // International aggregators
  "10times.com",
  "allevents.in",
  "eventbrite.com",
  "eventbrite.ru",
  "biztradeshows.com",
  "nuemd.com",
  "conferenceindex.org",
  "eventsofa.com",
  // Maps / search engines / wiki
  "yandex.ru",
  "maps.yandex.ru",
  "google.com",
  "google.ru",
  "maps.google.com",
  "wikipedia.org",
  "ru.wikipedia.org",
  "tripadvisor.com",
  // Social networks / messengers / video
  "vk.com",
  "vk.ru",
  "facebook.com",
  "instagram.com",
  "ok.ru",
  "t.me",
  "telegram.me",
  "telegram.org",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "rutube.ru",
  "zen.yandex.ru",
  "dzen.ru",
  // Media / news / tag/topic pages
  "afisha.ru",
  "kudago.com",
  "tass.ru",
  "rbc.ru",
  "kommersant.ru",
  "ria.ru",
  "interfax.ru",
  "vedomosti.ru",
  "zr.ru",
  "lenta.ru",
  "gazeta.ru",
  "izvestia.ru",
  "kp.ru",
  "rg.ru",
  "forbes.ru",
];

/**
 * URL path fragments that strongly suggest a tag/news/article page rather
 * than an organiser homepage, even when the host is otherwise neutral.
 */
const BAD_PATH_FRAGMENTS = [
  "/tags/",
  "/tag/",
  "/topic/",
  "/topics/",
  "/news/",
  "/article/",
  "/articles/",
  "/blog/",
  "/press/",
  "/press-release/",
];

export function isAggregatorDomain(domain: string): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  for (const bad of AGGREGATOR_DOMAINS) {
    if (d === bad || d.endsWith(`.${bad}`)) return true;
  }
  return false;
}

/**
 * Some hosts (e.g. accreditation/registration/ticket subdomains) are *related*
 * to an event but are not the official event homepage. Useful as a soft signal:
 * such URLs are kept but penalised, so a true main-domain candidate wins.
 */
const ANCILLARY_SUBDOMAIN_RE =
  /^(accreditation|register|registration|ticket|tickets|biletter|biglietteria|press|media|forms|api|admin|cabinet|lk|my)\./i;

function isAncillarySubdomain(domain: string): boolean {
  return ANCILLARY_SUBDOMAIN_RE.test(domain);
}

/**
 * Domains/keywords known to host official Russian exhibition sites. A small
 * curated list — the broader scoring still relies on token overlap, but a
 * match here adds a strong positive signal.
 */
const KNOWN_OFFICIAL_DOMAINS: { match: RegExp; boost: number }[] = [
  { match: /(^|\.)expocentr\.ru$/, boost: 0.3 },
  { match: /(^|\.)crocus-expo\.ru$/, boost: 0.2 },
  { match: /(^|\.)crocusexpo\.ru$/, boost: 0.2 },
  { match: /(^|\.)rosupack\.com$/, boost: 0.35 },
  { match: /(^|\.)mitt\.ru$/, boost: 0.35 },
  { match: /(^|\.)intercharm\.ru$/, boost: 0.35 },
  { match: /(^|\.)neftegaz-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)photonics-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)metobr-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)helirussia\.ru$/, boost: 0.35 },
  { match: /(^|\.)vodexpo\.ru$/, boost: 0.35 },
  { match: /(^|\.)ddexpo\.ru$/, boost: 0.35 },
  { match: /(^|\.)gntexpo\.ru$/, boost: 0.35 },
  { match: /(^|\.)logistika-expo\.ru$/, boost: 0.35 },
  { match: /(^|\.)wire-tradefair\.com$/, boost: 0.35 },
  { match: /(^|\.)kazanforum\.ru$/, boost: 0.3 },
  { match: /(^|\.)cipr\.ru$/, boost: 0.3 },
  { match: /(^|\.)ite-expo\.ru$/, boost: 0.3 },
  { match: /(^|\.)ite-russia\.ru$/, boost: 0.3 },
  { match: /(^|\.)hyve\.group$/, boost: 0.2 },
  { match: /(^|\.)expoforum\.ru$/, boost: 0.25 },
];

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
  "fair",
  "forum",
  "salon",
];

function hasBadPath(url: string): boolean {
  const lower = url.toLowerCase();
  return BAD_PATH_FRAGMENTS.some((f) => lower.includes(f));
}

/**
 * Returns the registrable "label" of a domain — i.e. the leftmost segment of
 * the eTLD+1 (e.g. `metobr-expo.ru` → `metobr-expo`, `accreditation.cipr2026.accreditation.ru`
 * → `accreditation`). Used to decide whether a title token appears in the
 * domain *itself* rather than only as a subdomain prefix.
 */
function domainLabel(domain: string): string {
  if (!domain) return "";
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] ?? "";
  return parts[parts.length - 2] ?? "";
}

export function scoreCandidate(
  cand: Candidate,
  titleTokens: string[],
  year: number | undefined,
): number {
  const { domain, url, snippet, snippetTitle } = cand;
  if (!url) return 0;

  // Aggregators are hard-floored — they should never beat a real candidate
  // and should never on their own clear the apply threshold.
  if (isAggregatorDomain(domain)) {
    // Allow a tiny non-zero score so ordering between aggregators is still
    // deterministic for dry-run logging, but cap well below minConfidence.
    let agg = 0.15;
    const fullText =
      `${domain} ${url} ${snippet} ${snippetTitle}`.toLowerCase();
    if (titleTokens.length) {
      let matched = 0;
      for (const tok of titleTokens) if (fullText.includes(tok)) matched++;
      agg += (matched / titleTokens.length) * 0.1;
    }
    if (hasBadPath(url)) agg -= 0.05;
    return Number(Math.max(0, Math.min(0.35, agg)).toFixed(3));
  }

  let score = 0.3; // base prior — we got *some* hit at all

  score += knownBoost(domain);

  const fullText =
    `${domain} ${url} ${snippet} ${snippetTitle}`.toLowerCase();
  const lowerTitle = snippetTitle.toLowerCase();
  const lowerSnippet = snippet.toLowerCase();
  const label = domainLabel(domain);

  let domainTokenHit = false;
  if (titleTokens.length) {
    let matched = 0;
    for (const tok of titleTokens) {
      if (fullText.includes(tok)) matched++;
    }
    const ratio = matched / titleTokens.length;
    score += ratio * 0.3;

    // Domain *label* itself includes a primary token → strong boost.
    // We only count meaningful tokens (≥4 chars) and only the head of the
    // title to avoid matching on filler words.
    const primaryTokens = titleTokens.slice(0, 3);
    for (const tok of primaryTokens) {
      if (tok.length >= 4 && label.includes(tok)) {
        score += 0.18;
        domainTokenHit = true;
        break;
      }
    }
  }

  // Year must appear somewhere — but a year on its own is weak; pair it with
  // domain/path presence rather than only snippet.
  if (year) {
    const ys = String(year);
    if (url.toLowerCase().includes(ys) || domain.includes(ys)) score += 0.1;
    else if (fullText.includes(ys)) score += 0.04;
  }

  // Snippet *title* should reference the event title for true official sites.
  if (titleTokens.length) {
    let titleMatched = 0;
    for (const tok of titleTokens) {
      if (tok.length >= 3 && lowerTitle.includes(tok)) titleMatched++;
    }
    if (titleMatched >= 2) score += 0.08;
    else if (titleMatched === 1) score += 0.03;

    let snippetMatched = 0;
    for (const tok of titleTokens) {
      if (tok.length >= 3 && lowerSnippet.includes(tok)) snippetMatched++;
    }
    if (snippetMatched >= 2) score += 0.05;
  }

  // .ru / official-looking hints
  if (/\.ru(\/|$)/.test(url) || /\.ru$/.test(domain)) score += 0.03;
  for (const hint of OFFICIAL_HINTS) {
    if (lowerTitle.includes(hint)) {
      score += 0.03;
      break;
    }
  }

  // Ancillary subdomains (accreditation., tickets., etc.) — keep but penalise
  // so the main event domain wins when both are present.
  if (isAncillarySubdomain(domain)) score -= 0.15;

  // Avoid PDFs / news article / tag URLs heuristically.
  if (/\.pdf($|\?)/i.test(url)) score -= 0.25;
  if (hasBadPath(url)) score -= 0.2;

  // Safety net: if neither the domain nor the snippet title matches the
  // event, this is almost certainly not the official site — cap the score.
  if (!domainTokenHit && titleTokens.length) {
    let titleHits = 0;
    for (const tok of titleTokens) {
      if (tok.length >= 3 && lowerTitle.includes(tok)) titleHits++;
    }
    if (titleHits === 0) score = Math.min(score, 0.55);
  }

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
    aggregator: isAggregatorDomain(c.domain),
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
