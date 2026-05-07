/**
 * Weekly background recheck of all smart-process exhibition cards that have
 * a SOURCE_URL set and an event-end date in the future.
 *
 * Designed to run on Render Cron (`render.yaml` defines the schedule). The
 * script is also runnable locally via `npx tsx server/cron/weekly-check.ts`
 * provided BITRIX_WEBHOOK_URL is set.
 *
 * Behavior:
 *   - Lists candidates via `crm.item.list` with `>eventEnd today`.
 *   - Reparses each URL with concurrency 1 and a configurable delay
 *     (`PARSE_RATE_LIMIT_MS`, default 1000ms) so we don't hammer organizer
 *     sites.
 *   - Updates only empty fields, writes a parse-log line, comments per
 *     change in the timeline.
 *   - Posts a roll-up notification via `im.notify.personal.add` to
 *     OWNER_USER_ID, or to a chat if CRON_REPORT_CHANNEL=chat.
 */

import "dotenv/config";
import { bx, bxListAll, hasWebhook } from "../lib/bitrix.js";
import {
  EXPO_DATE_FIELDS,
  EXPO_ENTITY_TYPE_ID,
  SMART_FIELDS,
  pickField,
} from "../lib/expoFields.js";
import {
  appendParseLog,
  buildParseLogLine,
  computeEnrichmentDiff,
  crmUpdateExpo,
  describeChange,
  timelineComment,
} from "../lib/smartEnrichment.js";
import { parseUrl } from "../parsers/index.js";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function notify(message: string) {
  const channel = (process.env.CRON_REPORT_CHANNEL ?? "personal").toLowerCase();
  try {
    if (channel === "chat" && process.env.CRON_REPORT_CHAT_ID) {
      await bx("im.message.add", {
        DIALOG_ID: process.env.CRON_REPORT_CHAT_ID,
        MESSAGE: message,
      });
    } else {
      const userId = Number(process.env.OWNER_USER_ID ?? "1");
      await bx("im.notify.personal.add", {
        USER_ID: userId,
        MESSAGE: message,
      });
    }
  } catch (err) {
    console.warn("[cron] notification failed:", err);
  }
}

async function main() {
  if (!hasWebhook()) {
    console.error("[cron] BITRIX_WEBHOOK_URL is required");
    process.exit(1);
  }
  const rateMs = Number(process.env.PARSE_RATE_LIMIT_MS ?? "1000");
  const todayIso = new Date().toISOString().slice(0, 10);

  console.log(`[cron] starting weekly check (rateMs=${rateMs}, today=${todayIso})`);

  const items = await bxListAll<any>("crm.item.list", {
    entityTypeId: EXPO_ENTITY_TYPE_ID,
    select: [
      "id",
      "title",
      SMART_FIELDS.sourceUrl,
      SMART_FIELDS.parseLog,
      EXPO_DATE_FIELDS.eventStart,
      EXPO_DATE_FIELDS.eventEnd,
      EXPO_DATE_FIELDS.mountStart,
      EXPO_DATE_FIELDS.mountEnd,
      EXPO_DATE_FIELDS.dismantleStart,
      EXPO_DATE_FIELDS.dismantleEnd,
    ],
    filter: { [`>${EXPO_DATE_FIELDS.eventEnd}`]: todayIso },
  });

  const targets = items.filter((it) => {
    const url = pickField(it, SMART_FIELDS.sourceUrl, "UF_CRM_8_SOURCE_URL");
    return typeof url === "string" && url.length > 0;
  });
  console.log(`[cron] candidates: ${targets.length} of ${items.length}`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Group by hostname so we can sleep `rateMs` between hits to the same
  // domain (`p-queue` pulls in a chunky dep we don't actually need here).
  const lastTouchByHost = new Map<string, number>();

  for (const item of targets) {
    const id = Number(item.id ?? item.ID);
    const url = pickField(item, SMART_FIELDS.sourceUrl, "UF_CRM_8_SOURCE_URL") as string;
    const host = safeHost(url);
    const last = lastTouchByHost.get(host) ?? 0;
    const wait = Math.max(0, rateMs - (Date.now() - last));
    if (wait > 0) await sleep(wait);
    lastTouchByHost.set(host, Date.now());

    try {
      const parsed = await parseUrl(url);
      const { fields, changes } = computeEnrichmentDiff(item, parsed);
      fields[SMART_FIELDS.lastChecked] = new Date().toISOString();
      if (parsed.confidence >= 1.0 && changes.length > 0) {
        fields[SMART_FIELDS.verified] = "Y";
      }
      const existingLog = pickField(item, SMART_FIELDS.parseLog, "UF_CRM_8_PARSE_LOG");
      fields[SMART_FIELDS.parseLog] = appendParseLog(
        existingLog,
        buildParseLogLine(parsed, "cron"),
      );
      await crmUpdateExpo(id, fields);
      for (const change of changes) {
        await timelineComment(id, describeChange(change, url));
      }
      if (changes.length > 0) updated++;
      else skipped++;
      console.log(`[cron] #${id} ${url} parser=${parsed.parser} confidence=${parsed.confidence.toFixed(2)} changes=${changes.length}`);
    } catch (err) {
      errors++;
      console.error(`[cron] #${id} failed:`, err);
    }
  }

  const summary =
    `Weekly recheck: scanned=${items.length} candidates=${targets.length} updated=${updated} skipped=${skipped} errors=${errors}`;
  console.log(`[cron] ${summary}`);
  await notify(summary);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

main().catch((err) => {
  console.error("[cron] fatal", err);
  process.exit(1);
});
