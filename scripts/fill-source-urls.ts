/**
 * Fills the Source URL field on future exhibitions (smart process 1050)
 * by searching the public web for an official-looking URL.
 *
 * Run via Render Shell:
 *   npm run fill-source-urls -- --dry-run --limit=20
 *   npm run fill-source-urls -- --apply --min-confidence=0.75
 *
 * Defaults to dry-run unless --apply is passed.
 */
import {
  scoreCandidate,
  buildSearchQueries,
  normalizeTitleTokens,
  extractDdgResults,
  isFutureExhibition,
  isAggregatorDomain,
  pickBestCandidate,
  appendParseLogLine,
  ENTITY_TYPE_ID,
  SOURCE_FIELD_KEYS,
  type Candidate,
} from "./fill-source-urls/lib.ts";
import { bx, hasWebhook } from "../server/lib/bitrix.ts";

type CliFlags = {
  dryRun: boolean;
  apply: boolean;
  limit: number;
  minConfidence: number;
  since?: string;
  sleepMs: number;
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: true,
    apply: false,
    limit: 0,
    // Higher default: we have learned that 0.75 still lets aggregators
    // through occasionally. Apply runs should be conservative — better
    // to skip more than to write a wrong URL into CRM. Dry-run callers
    // can lower this with --min-confidence=0.6 to inspect borderline hits.
    minConfidence: 0.85,
    sleepMs: 1000,
  };
  for (const raw of argv.slice(2)) {
    if (raw === "--apply") {
      flags.apply = true;
      flags.dryRun = false;
      continue;
    }
    if (raw === "--dry-run") {
      flags.dryRun = true;
      flags.apply = false;
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq === -1) continue;
    const key = raw.slice(0, eq);
    const val = raw.slice(eq + 1);
    switch (key) {
      case "--limit":
        flags.limit = Math.max(0, Number.parseInt(val, 10) || 0);
        break;
      case "--min-confidence": {
        const n = Number.parseFloat(val);
        if (Number.isFinite(n)) flags.minConfidence = n;
        break;
      }
      case "--since":
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) flags.since = val;
        break;
      case "--sleep-ms": {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n) && n >= 0) flags.sleepMs = n;
        break;
      }
    }
  }
  return flags;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CrmItem = Record<string, any>;

async function listFutureCandidates(
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
    const result = await bx<{ items?: CrmItem[]; next?: number }>(
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

const UA =
  "Mozilla/5.0 (compatible; ExpoSourceFinder/1.0; +https://b24-5syfa7.bitrix24.ru)";

async function ddgSearch(
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
      await sleep(1500);
      return ddgSearch(query, attempt + 1);
    }
    throw err;
  }
}

function yearFromIso(iso: string | undefined | null): number | undefined {
  if (!iso || typeof iso !== "string") return undefined;
  const m = iso.match(/^(\d{4})/);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

type ScanResult = {
  itemId: number;
  title: string;
  chosenUrl: string;
  confidence: number;
  query: string;
  status:
    | "found"
    | "updated"
    | "skippedLowConfidence"
    | "skippedAggregator"
    | "skippedNoResults"
    | "skippedError"
    | "dryRun";
  note?: string;
};

async function processItem(
  item: CrmItem,
  flags: CliFlags,
  todayIso: string,
): Promise<ScanResult> {
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
      results = await ddgSearch(q);
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
    await sleep(flags.sleepMs);
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
  // Aggregators / directories / social / media are *never* written to CRM,
  // regardless of their numeric score. Surface them in dry-run output so a
  // human reviewer can decide whether to add them by hand, but treat the
  // item itself as un-fillable here.
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
  if (best.score < flags.minConfidence) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedLowConfidence",
    };
  }

  if (flags.dryRun) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "dryRun",
    };
  }

  const nowIso = new Date().toISOString();
  const logLine = `${todayIso}: URL найден автоматически: ${best.url} (confidence ${best.score.toFixed(2)}, query ${lastQuery})`;
  const newLog = appendParseLogLine(parseLogOf(item), logLine, 10);

  try {
    await bx("crm.item.update", {
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
    };
  } catch (err) {
    return {
      itemId: Number(item.id),
      title,
      chosenUrl: best.url,
      confidence: best.score,
      query: lastQuery,
      status: "skippedError",
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  if (!hasWebhook()) {
    console.error(
      "BITRIX_WEBHOOK_URL is not set. Aborting. (No secrets are printed.)",
    );
    process.exit(1);
  }

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  console.log(
    `[fill-source-urls] mode=${flags.apply ? "APPLY" : "DRY-RUN"} today=${todayIso}` +
      ` minConfidence=${flags.minConfidence} limit=${flags.limit || "∞"}` +
      ` sleepMs=${flags.sleepMs}${flags.since ? ` since=${flags.since}` : ""}`,
  );

  let items: CrmItem[];
  try {
    items = await listFutureCandidates(todayIso, flags.since);
  } catch (err) {
    console.error(
      "Failed to list CRM items:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  }

  const scanned = items.length;
  const future = items.filter((it) =>
    isFutureExhibition(
      typeof it.ufCrm8_1766066501630 === "string"
        ? it.ufCrm8_1766066501630
        : null,
      todayIso,
    ),
  );
  const empty = future.filter((it) => !sourceUrlOf(it));
  const queue = flags.limit > 0 ? empty.slice(0, flags.limit) : empty;

  console.log(
    `[fill-source-urls] scanned=${scanned} future=${future.length} futureEmpty=${empty.length} queue=${queue.length}`,
  );

  const results: ScanResult[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const r = await processItem(item, flags, todayIso);
    results.push(r);
    const line =
      `  [${i + 1}/${queue.length}] id=${r.itemId} ` +
      `${r.status.padEnd(22)} conf=${r.confidence.toFixed(2)} ` +
      `${r.chosenUrl || "-"}  «${r.title}»` +
      (r.note ? `  (${r.note})` : "");
    console.log(line);
    await sleep(flags.sleepMs);
  }

  const counts = {
    scanned,
    futureEmpty: empty.length,
    found: results.filter((r) =>
      ["found", "updated", "dryRun"].includes(r.status),
    ).length,
    updated: results.filter((r) => r.status === "updated").length,
    skippedLowConfidence: results.filter(
      (r) => r.status === "skippedLowConfidence",
    ).length,
    skippedAggregator: results.filter((r) => r.status === "skippedAggregator")
      .length,
    skippedNoResults: results.filter((r) => r.status === "skippedNoResults")
      .length,
    errors: results.filter((r) => r.status === "skippedError").length,
  };
  console.log(`\n[fill-source-urls] summary ${JSON.stringify(counts)}`);

  const top = results.slice(0, 50);
  console.log("\n[fill-source-urls] top per-item:");
  for (const r of top) {
    console.log(
      `  id=${r.itemId} status=${r.status} conf=${r.confidence.toFixed(2)} ` +
        `url=${r.chosenUrl || "-"} title=«${r.title}»`,
    );
  }
}

const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return argv1.includes("fill-source-urls");
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(
      "[fill-source-urls] fatal:",
      err instanceof Error ? err.message : err,
    );
    process.exit(3);
  });
}
