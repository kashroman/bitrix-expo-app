/**
 * Reusable service layer for the Source URL fill job.
 *
 * Extracted from scripts/fill-source-urls.ts so the same logic can be invoked
 * from the CLI (Render Shell) and from the protected `/api/admin/fill-source-urls`
 * endpoint without duplicating risky write-paths.
 *
 * Safety invariants enforced here regardless of caller:
 *   - existing non-empty Source URL fields are NEVER overwritten
 *   - only future-dated exhibitions (entityTypeId=1050) are considered
 *   - aggregator/media/social domains are always hard-skipped
 *   - apply writes require allowlist match unless allowUnlisted=true
 */
import {
  buildSearchQueries,
  normalizeTitleTokens,
  extractDdgResults,
  isFutureExhibition,
  isAggregatorDomain,
  isAllowlistedDomain,
  pickBestCandidate,
  appendParseLogLine,
  ENTITY_TYPE_ID,
  OFFICIAL_ALLOWLIST_DOMAINS,
  SOURCE_FIELD_KEYS,
  type Candidate,
} from "../../scripts/fill-source-urls/lib.ts";
import { bx } from "./bitrix.ts";

export const FILL_SOURCE_URLS_DEFAULTS = {
  minConfidence: 0.85,
  sleepMs: 1000,
  allowUnlisted: false,
  limit: 0,
} as const;

export type FillSourceUrlsProgress = {
  phase: "scanning" | "processing" | "done";
  scanned: number;
  future: number;
  futureEmpty: number;
  queue: number;
  processed: number;
  results: FillSourceUrlsItemResult[];
};

export type FillSourceUrlsOptions = {
  /** When true (default), no CRM writes happen. */
  dryRun?: boolean;
  /** Maximum number of empty-future items to process. 0 = unlimited. */
  limit?: number;
  /** Minimum candidate score to consider; defaults to 0.85. */
  minConfidence?: number;
  /** Optional ISO date (YYYY-MM-DD); only items with begin >= since are considered. */
  since?: string;
  /** Delay between DuckDuckGo / per-item operations, in ms. */
  sleepMs?: number;
  /** Allow apply against domains outside OFFICIAL_ALLOWLIST_DOMAINS. */
  allowUnlisted?: boolean;
  /**
   * Optional whitelist of Bitrix item IDs to process. When provided, items
   * outside this set are filtered out AFTER the future-only / empty filter,
   * so existing safety gates still apply. Use this to apply only a reviewed
   * subset of dry-run candidates.
   */
  onlyIds?: number[];
  /** Override today's date (mainly for tests). */
  todayIso?: string;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /** Optional progress callback fired after each item (and once after scanning). */
  onProgress?: (p: FillSourceUrlsProgress) => void;
};

export class FillSourceUrlsAbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "FillSourceUrlsAbortError";
  }
}

export type FillSourceUrlsStatus =
  | "found"
  | "updated"
  | "dryRun"
  | "skippedLowConfidence"
  | "skippedAggregator"
  | "skippedNotAllowlisted"
  | "skippedNoResults"
  | "skippedError";

export type FillSourceUrlsItemResult = {
  itemId: number;
  title: string;
  chosenUrl: string;
  confidence: number;
  query: string;
  status: FillSourceUrlsStatus;
  allowlisted?: boolean;
  applyEligible?: boolean;
  note?: string;
};

export type FillSourceUrlsSummary = {
  mode: "dryRun" | "apply";
  todayIso: string;
  minConfidence: number;
  limit: number;
  allowUnlisted: boolean;
  scanned: number;
  future: number;
  futureEmpty: number;
  queue: number;
  skippedNotSelected: number;
  found: number;
  updated: number;
  skippedLowConfidence: number;
  skippedAggregator: number;
  skippedNotAllowlisted: number;
  skippedNoResults: number;
  errors: number;
  dryRunApplyEligible: number;
  dryRunNotAllowlisted: number;
  allowlistEntries: number;
  results: FillSourceUrlsItemResult[];
};

type CrmItem = Record<string, any>;

type Deps = {
  bx: typeof bx;
  ddgSearch: (
    q: string,
  ) => Promise<{ url: string; title: string; snippet: string }[]>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

function sourceUrlOf(item: CrmItem): string {
  for (const key of SOURCE_FIELD_KEYS.url) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function parseLogOf(item: CrmItem): string {
  for (const key of SOURCE_FIELD_KEYS.parseLog) {
    const v = item[key];
    if (typeof v === "string") return v;
  }
  return "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function yearFromIso(iso: string | undefined | null): number | undefined {
  if (!iso || typeof iso !== "string") return undefined;
  const m = iso.match(/^(\d{4})/);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

const UA =
  "Mozilla/5.0 (compatible; ExpoSourceFinder/1.0; +https://b24-5syfa7.bitrix24.ru)";

export async function defaultDdgSearch(
  query: string,
  attempt = 1,
): Promise<{ url: string; title: string; snippet: string }[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru,en;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`ddg status ${res.status}`);
      }
      return [];
    }
    const html = await res.text();
    return extractDdgResults(html);
  } catch (err) {
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return defaultDdgSearch(query, attempt + 1);
    }
    throw err;
  }
}

async function listFutureCandidates(
  deps: Deps,
  todayIso: string,
  since: string | undefined,
): Promise<CrmItem[]> {
  const select = [
    "id",
    "title",
    "ufCrm8_1766066484758",
    "ufCrm8_1766066501630",
    "ufCrm8SourceUrl",
    "ufCrm8ParseLog",
    "UF_CRM_8_SOURCE_URL",
    "UF_CRM_8_PARSE_LOG",
  ];
  const filter: Record<string, unknown> = {
    ">=ufCrm8_1766066501630": todayIso,
  };
  if (since) filter[">=ufCrm8_1766066484758"] = since;

  const out: CrmItem[] = [];
  let start = 0;
  let safety = 0;
  while (safety < 50) {
    safety++;
    const result = await deps.bx<{ items?: CrmItem[]; next?: number }>(
      "crm.item.list",
      {
        entityTypeId: ENTITY_TYPE_ID,
        select,
        filter,
        order: { ufCrm8_1766066484758: "ASC" },
        start,
      },
    );
    const items = result?.items ?? [];
    out.push(...items);
    const next = result?.next;
    if (typeof next === "number" && next > start) {
      start = next;
      continue;
    }
    break;
  }
  return out;
}

async function processItem(
  deps: Deps,
  item: CrmItem,
  opts: Required<
    Pick<
      FillSourceUrlsOptions,
      "dryRun" | "minConfidence" | "sleepMs" | "allowUnlisted"
    >
  >,
  todayIso: string,
): Promise<FillSourceUrlsItemResult> {
  const title = String(item.title ?? "").trim();
  const eventStart =
    typeof item.ufCrm8_1766066484758 === "string"
      ? item.ufCrm8_1766066484758
      : undefined;
  const year = yearFromIso(eventStart);
  const tokens = normalizeTitleTokens(title);
  const queries = buildSearchQueries(title, year);

  const allCandidates: Candidate[] = [];
  let lastQuery = queries[0] ?? title;
  for (const q of queries) {
    lastQuery = q;
    let results: { url: string; title: string; snippet: string }[] = [];
    try {
      results = await deps.ddgSearch(q);
    } catch (err) {
      return {
        itemId: Number(item.id),
        title,
        chosenUrl: "",
        confidence: 0,
        query: q,
        status: "skippedError",
        note: err instanceof Error ? err.message : String(err),
      };
    }
    for (const r of results) {
      allCandidates.push({
        url: r.url,
        domain: safeHost(r.url),
        snippet: r.snippet,
        snippetTitle: r.title,
      });
    }
    if (allCandidates.length >= 12) break;
    await deps.sleep(opts.sleepMs);
  }

  const best = pickBestCandidate(allCandidates, tokens, year);
  if (!best) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: "",
      confidence: 0,
      query: lastQuery,
      status: "skippedNoResults",
    };
  }
  if (best.aggregator || isAggregatorDomain(best.domain)) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedAggregator",
    };
  }
  const allowlisted = isAllowlistedDomain(best.domain);
  const meetsScore = best.score >= opts.minConfidence;
  const applyEligible = meetsScore && (allowlisted || opts.allowUnlisted);

  if (!meetsScore) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedLowConfidence",
      allowlisted,
      applyEligible: false,
    };
  }

  if (opts.dryRun) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "dryRun",
      allowlisted,
      applyEligible,
      note: applyEligible ? undefined : "would skip in apply: not allowlisted",
    };
  }

  // Apply path. Re-check allowlist as final safety net.
  if (!allowlisted && !opts.allowUnlisted) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedNotAllowlisted",
      allowlisted: false,
      applyEligible: false,
    };
  }

  // Never overwrite an existing source URL. The query filter already excludes
  // these, but defend in depth against races.
  if (sourceUrlOf(item)) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedError",
      allowlisted,
      applyEligible,
      note: "existing source url; refused to overwrite",
    };
  }

  const nowIso = deps.now().toISOString();
  const logLine = `${todayIso}: URL найден автоматически: ${best.url} (confidence ${best.score.toFixed(2)}, query ${lastQuery})`;
  const newLog = appendParseLogLine(parseLogOf(item), logLine, 10);

  try {
    await deps.bx("crm.item.update", {
      entityTypeId: ENTITY_TYPE_ID,
      id: Number(item.id),
      fields: {
        ufCrm8SourceUrl: best.url,
        ufCrm8LastChecked: nowIso,
        ufCrm8ParseLog: newLog,
      },
    });
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "updated",
      allowlisted,
      applyEligible: true,
    };
  } catch (err) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedError",
      allowlisted,
      applyEligible,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarize(
  results: FillSourceUrlsItemResult[],
  base: Omit<FillSourceUrlsSummary, keyof typeof EMPTY_COUNTS | "results">,
): FillSourceUrlsSummary {
  return {
    ...base,
    found: results.filter((r) =>
      ["found", "updated", "dryRun"].includes(r.status),
    ).length,
    updated: results.filter((r) => r.status === "updated").length,
    skippedLowConfidence: results.filter(
      (r) => r.status === "skippedLowConfidence",
    ).length,
    skippedAggregator: results.filter((r) => r.status === "skippedAggregator")
      .length,
    skippedNotAllowlisted: results.filter(
      (r) => r.status === "skippedNotAllowlisted",
    ).length,
    skippedNoResults: results.filter((r) => r.status === "skippedNoResults")
      .length,
    errors: results.filter((r) => r.status === "skippedError").length,
    dryRunApplyEligible: results.filter(
      (r) => r.status === "dryRun" && r.applyEligible === true,
    ).length,
    dryRunNotAllowlisted: results.filter(
      (r) => r.status === "dryRun" && r.applyEligible === false,
    ).length,
    results,
  };
}

const EMPTY_COUNTS = {
  found: 0,
  updated: 0,
  skippedLowConfidence: 0,
  skippedAggregator: 0,
  skippedNotAllowlisted: 0,
  skippedNoResults: 0,
  errors: 0,
  dryRunApplyEligible: 0,
  dryRunNotAllowlisted: 0,
};

/**
 * Run the source-URL fill job. Defaults to dryRun=true.
 *
 * This is the single source of truth for both the CLI script and the protected
 * admin endpoint. All safety gates (allowlist, aggregator hard-skip, never
 * overwrite existing URL, future-only) are enforced here.
 */
export async function runFillSourceUrls(
  options: FillSourceUrlsOptions = {},
  injected: Partial<Deps> = {},
): Promise<FillSourceUrlsSummary> {
  const deps: Deps = {
    bx: injected.bx ?? bx,
    ddgSearch: injected.ddgSearch ?? defaultDdgSearch,
    sleep:
      injected.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    now: injected.now ?? (() => new Date()),
  };
  const dryRun = options.dryRun !== false; // dry-run is default
  const limit = Math.max(0, options.limit ?? FILL_SOURCE_URLS_DEFAULTS.limit);
  const minConfidence =
    typeof options.minConfidence === "number" && Number.isFinite(options.minConfidence)
      ? options.minConfidence
      : FILL_SOURCE_URLS_DEFAULTS.minConfidence;
  const sleepMs = Math.max(
    0,
    options.sleepMs ?? FILL_SOURCE_URLS_DEFAULTS.sleepMs,
  );
  const allowUnlisted = Boolean(
    options.allowUnlisted ?? FILL_SOURCE_URLS_DEFAULTS.allowUnlisted,
  );
  const todayIso =
    options.todayIso ?? deps.now().toISOString().slice(0, 10);

  const checkAborted = () => {
    if (options.signal?.aborted) throw new FillSourceUrlsAbortError();
  };

  checkAborted();
  const items = await listFutureCandidates(deps, todayIso, options.since);

  const scanned = items.length;
  const futureItems = items.filter((it) =>
    isFutureExhibition(
      typeof it.ufCrm8_1766066501630 === "string"
        ? it.ufCrm8_1766066501630
        : null,
      todayIso,
    ),
  );
  const empty = futureItems.filter((it) => !sourceUrlOf(it));
  const onlyIdsSet =
    options.onlyIds && options.onlyIds.length > 0
      ? new Set(options.onlyIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)))
      : null;
  const selected = onlyIdsSet
    ? empty.filter((it) => onlyIdsSet.has(Number(it.id)))
    : empty;
  const skippedNotSelected = onlyIdsSet ? empty.length - selected.length : 0;
  const queue = limit > 0 ? selected.slice(0, limit) : selected;

  const results: FillSourceUrlsItemResult[] = [];

  if (options.onProgress) {
    options.onProgress({
      phase: "scanning",
      scanned,
      future: futureItems.length,
      futureEmpty: empty.length,
      queue: queue.length,
      processed: 0,
      results: [],
    });
  }

  for (const item of queue) {
    checkAborted();
    const r = await processItem(
      deps,
      item,
      { dryRun, minConfidence, sleepMs, allowUnlisted },
      todayIso,
    );
    results.push(r);
    if (options.onProgress) {
      options.onProgress({
        phase: "processing",
        scanned,
        future: futureItems.length,
        futureEmpty: empty.length,
        queue: queue.length,
        processed: results.length,
        results: results.slice(),
      });
    }
    await deps.sleep(sleepMs);
  }

  const summary = summarize(results, {
    mode: dryRun ? "dryRun" : "apply",
    todayIso,
    minConfidence,
    limit,
    allowUnlisted,
    scanned,
    future: futureItems.length,
    futureEmpty: empty.length,
    queue: queue.length,
    skippedNotSelected,
    allowlistEntries: OFFICIAL_ALLOWLIST_DOMAINS.length,
  });

  if (options.onProgress) {
    options.onProgress({
      phase: "done",
      scanned,
      future: futureItems.length,
      futureEmpty: empty.length,
      queue: queue.length,
      processed: results.length,
      results: results.slice(),
    });
  }

  return summary;
}
