/**
 * Fills the Source URL field on future exhibitions (smart process 1050)
 * by searching the public web for an official-looking URL.
 *
 * Run via Render Shell:
 *   npm run fill-source-urls -- --dry-run --limit=20
 *   npm run fill-source-urls -- --apply --min-confidence=0.75
 *
 * Defaults to dry-run unless --apply is passed.
 *
 * The job logic itself lives in server/lib/fillSourceUrls.ts so the same
 * code path is shared with the protected /api/admin/fill-source-urls
 * endpoint — keep risky write logic in one place.
 */
import { hasWebhook } from "../server/lib/bitrix.ts";
import {
  runFillSourceUrls,
  FILL_SOURCE_URLS_DEFAULTS,
} from "../server/lib/fillSourceUrls.ts";
import { OFFICIAL_ALLOWLIST_DOMAINS } from "./fill-source-urls/lib.ts";

type CliFlags = {
  dryRun: boolean;
  apply: boolean;
  limit: number;
  minConfidence: number;
  since?: string;
  sleepMs: number;
  allowUnlisted: boolean;
  printAllowlist: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: true,
    apply: false,
    limit: 0,
    minConfidence: FILL_SOURCE_URLS_DEFAULTS.minConfidence,
    sleepMs: FILL_SOURCE_URLS_DEFAULTS.sleepMs,
    allowUnlisted: false,
    printAllowlist: false,
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
    if (raw === "--allow-unlisted") {
      flags.allowUnlisted = true;
      continue;
    }
    if (raw === "--print-allowlist") {
      flags.printAllowlist = true;
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

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  if (flags.printAllowlist) {
    console.log(
      `[fill-source-urls] official allowlist (${OFFICIAL_ALLOWLIST_DOMAINS.length} entries):`,
    );
    for (const d of OFFICIAL_ALLOWLIST_DOMAINS) console.log(`  ${d}`);
    return;
  }
  if (!hasWebhook()) {
    console.error(
      "BITRIX_WEBHOOK_URL is not set. Aborting. (No secrets are printed.)",
    );
    process.exit(1);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  console.log(
    `[fill-source-urls] mode=${flags.apply ? "APPLY" : "DRY-RUN"} today=${todayIso}` +
      ` minConfidence=${flags.minConfidence} limit=${flags.limit || "∞"}` +
      ` sleepMs=${flags.sleepMs}${flags.since ? ` since=${flags.since}` : ""}` +
      ` allowlistEntries=${OFFICIAL_ALLOWLIST_DOMAINS.length}` +
      ` allowUnlisted=${flags.allowUnlisted}`,
  );

  let summary;
  try {
    summary = await runFillSourceUrls({
      dryRun: flags.dryRun,
      limit: flags.limit,
      minConfidence: flags.minConfidence,
      since: flags.since,
      sleepMs: flags.sleepMs,
      allowUnlisted: flags.allowUnlisted,
      todayIso,
    });
  } catch (err) {
    console.error(
      "Failed to run fill job:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  }

  console.log(
    `[fill-source-urls] scanned=${summary.scanned} future=${summary.future} futureEmpty=${summary.futureEmpty} queue=${summary.queue}`,
  );
  for (let i = 0; i < summary.results.length; i++) {
    const r = summary.results[i];
    const allowFlag =
      r.allowlisted === undefined
        ? ""
        : r.allowlisted
          ? " allow=Y"
          : " allow=N";
    const line =
      `  [${i + 1}/${summary.results.length}] id=${r.itemId} ` +
      `${r.status.padEnd(22)} conf=${r.confidence.toFixed(2)}${allowFlag} ` +
      `${r.chosenUrl || "-"}  «${r.title}»` +
      (r.note ? `  (${r.note})` : "");
    console.log(line);
  }

  const counts = {
    scanned: summary.scanned,
    futureEmpty: summary.futureEmpty,
    found: summary.found,
    updated: summary.updated,
    skippedLowConfidence: summary.skippedLowConfidence,
    skippedAggregator: summary.skippedAggregator,
    skippedNotAllowlisted: summary.skippedNotAllowlisted,
    skippedNoResults: summary.skippedNoResults,
    errors: summary.errors,
    dryRunApplyEligible: summary.dryRunApplyEligible,
    dryRunNotAllowlisted: summary.dryRunNotAllowlisted,
  };
  console.log(`\n[fill-source-urls] summary ${JSON.stringify(counts)}`);

  console.log("\n[fill-source-urls] top per-item:");
  for (const r of summary.results.slice(0, 50)) {
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
