/**
 * Core service used by /api/smart-add, /api/manual-add and /api/recheck.
 *
 * Responsibilities:
 *   - Translate a ParseResult into a `crm.item.add` / `crm.item.update`
 *     payload, never overwriting non-empty fields the user manually filled.
 *   - Append rolling parse log entries (last 10).
 *   - Write a Bitrix timeline comment per auto-update so operators can audit
 *     what changed and why.
 *
 * The integration leans on an inbound webhook (`BITRIX_WEBHOOK_URL`). When
 * the webhook is missing, the helpers throw `BitrixWebhookRequiredError` so
 * routes can surface a 503 with a clear message.
 */

import { bx, BitrixWebhookRequiredError } from "./bitrix.js";
import {
  EXPO_ENTITY_TYPE_ID,
  EXPO_DATE_FIELDS,
  SMART_FIELDS,
  SMART_FIELDS_ORIGINAL,
  pickField,
} from "./expoFields.js";
import type { ParseResult } from "../parsers/index.js";
import { calculateDates } from "../utils/calculateDates.js";

const FIELD_LABELS: Record<string, string> = {
  [EXPO_DATE_FIELDS.eventStart]: "Дата начала",
  [EXPO_DATE_FIELDS.eventEnd]: "Дата окончания",
  [EXPO_DATE_FIELDS.mountStart]: "Монтаж: начало",
  [EXPO_DATE_FIELDS.mountEnd]: "Монтаж: конец",
  [EXPO_DATE_FIELDS.dismantleStart]: "Демонтаж: начало",
  [EXPO_DATE_FIELDS.dismantleEnd]: "Демонтаж: конец",
  [SMART_FIELDS.sourceUrl]: "Источник (URL)",
  [SMART_FIELDS.lastChecked]: "Дата последней проверки",
  [SMART_FIELDS.verified]: "Верифицировано",
  [SMART_FIELDS.calculated]: "Расчётные даты",
};

export type SmartCreateOptions = {
  url: string;
  parsed: ParseResult;
  /** When parsed lacks montage/dismantle, fill them via heuristic. */
  fillCalculated?: boolean;
};

export type ParseLogEntry = { ts: string; line: string };

export function buildParseLogLine(parsed: ParseResult, prefix: string): string {
  const parts = [
    `${prefix}@${new Date().toISOString()}`,
    `host=${parsed.host}`,
    `parser=${parsed.parser}`,
    `confidence=${parsed.confidence.toFixed(2)}`,
  ];
  if (parsed.beginDate) parts.push(`begin=${parsed.beginDate}`);
  if (parsed.endDate) parts.push(`end=${parsed.endDate}`);
  if (parsed.montageStart) parts.push(`mount=${parsed.montageStart}`);
  if (parsed.dismantleStart) parts.push(`dismantle=${parsed.dismantleStart}`);
  if (parsed.notes.length) parts.push(`notes=${parsed.notes.slice(0, 3).join("|")}`);
  return parts.join(" ");
}

/** Append a new entry to a parse log, keeping only the last 10 lines. */
export function appendParseLog(existing: unknown, line: string): string {
  const text = typeof existing === "string" ? existing : "";
  const lines = text ? text.split(/\r?\n/).filter(Boolean) : [];
  lines.push(line);
  return lines.slice(-10).join("\n");
}

export type CrmItem = Record<string, any> & { id?: number; ID?: number };

/**
 * Compute the field updates we'd apply to a CRM item to enrich it from a
 * parse result, **never** overwriting non-empty values. Returns the diff in
 * a form suitable for `crm.item.update` plus a list of human-readable
 * change descriptions used for timeline comments.
 */
export function computeEnrichmentDiff(
  existing: CrmItem | undefined,
  parsed: ParseResult,
  opts: { calculated?: boolean } = {},
): { fields: Record<string, any>; changes: { code: string; label: string; from: any; to: any }[] } {
  const fields: Record<string, any> = {};
  const changes: { code: string; label: string; from: any; to: any }[] = [];

  const apply = (code: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (existing) {
      const cur = pickField(existing, code, code.toUpperCase());
      if (cur !== undefined && cur !== null && cur !== "" && !(Array.isArray(cur) && cur.length === 0)) {
        return; // never overwrite manually-filled values
      }
    }
    fields[code] = value;
    changes.push({
      code,
      label: FIELD_LABELS[code] ?? code,
      from: existing ? pickField(existing, code, code.toUpperCase()) : undefined,
      to: value,
    });
  };

  if (parsed.beginDate) apply(EXPO_DATE_FIELDS.eventStart, parsed.beginDate);
  if (parsed.endDate) apply(EXPO_DATE_FIELDS.eventEnd, parsed.endDate);

  // Mount fields are sometimes multi-valued (UI: "multiple=yes") — when
  // populating from scratch we pass an array so Bitrix accepts both shapes.
  if (parsed.montageStart) apply(EXPO_DATE_FIELDS.mountStart, [parsed.montageStart]);
  if (parsed.montageEnd) apply(EXPO_DATE_FIELDS.mountEnd, parsed.montageEnd);
  if (parsed.dismantleStart) apply(EXPO_DATE_FIELDS.dismantleStart, parsed.dismantleStart);
  if (parsed.dismantleEnd) apply(EXPO_DATE_FIELDS.dismantleEnd, parsed.dismantleEnd);

  if (opts.calculated) {
    fields[SMART_FIELDS.calculated] = "Y";
    changes.push({ code: SMART_FIELDS.calculated, label: FIELD_LABELS[SMART_FIELDS.calculated], from: undefined, to: "Y" });
  }

  return { fields, changes };
}

/**
 * Build the full payload for `crm.item.add` (smart-process create flow).
 * Used by /api/smart-add/confirm and /api/manual-add.
 */
export function buildCreatePayload(opts: {
  title: string;
  url?: string;
  parsed?: ParseResult;
  verified?: boolean;
  calculated?: boolean;
  parseLog?: string;
}): Record<string, any> {
  const fields: Record<string, any> = {
    title: opts.title,
  };
  if (opts.parsed) {
    if (opts.parsed.beginDate) fields[EXPO_DATE_FIELDS.eventStart] = opts.parsed.beginDate;
    if (opts.parsed.endDate) fields[EXPO_DATE_FIELDS.eventEnd] = opts.parsed.endDate;
    if (opts.parsed.montageStart) fields[EXPO_DATE_FIELDS.mountStart] = [opts.parsed.montageStart];
    if (opts.parsed.montageEnd) fields[EXPO_DATE_FIELDS.mountEnd] = opts.parsed.montageEnd;
    if (opts.parsed.dismantleStart) fields[EXPO_DATE_FIELDS.dismantleStart] = opts.parsed.dismantleStart;
    if (opts.parsed.dismantleEnd) fields[EXPO_DATE_FIELDS.dismantleEnd] = opts.parsed.dismantleEnd;
  }
  if (opts.url) fields[SMART_FIELDS.sourceUrl] = opts.url;
  fields[SMART_FIELDS.lastChecked] = new Date().toISOString();
  fields[SMART_FIELDS.verified] = opts.verified ? "Y" : "N";
  fields[SMART_FIELDS.calculated] = opts.calculated ? "Y" : "N";
  if (opts.parseLog) fields[SMART_FIELDS.parseLog] = opts.parseLog;
  return fields;
}

/** Minimal helper around `crm.item.add` for the smart-process. */
export async function crmCreateExpo(fields: Record<string, any>): Promise<number> {
  const result: any = await bx("crm.item.add", {
    entityTypeId: EXPO_ENTITY_TYPE_ID,
    fields,
  });
  const id = result?.item?.id ?? result?.item?.ID ?? result?.id ?? result?.ID;
  return Number(id);
}

/** Minimal helper around `crm.item.update`. */
export async function crmUpdateExpo(itemId: number, fields: Record<string, any>): Promise<void> {
  await bx("crm.item.update", {
    entityTypeId: EXPO_ENTITY_TYPE_ID,
    id: itemId,
    fields,
  });
}

export async function crmGetExpo(itemId: number): Promise<CrmItem | undefined> {
  const result: any = await bx("crm.item.get", {
    entityTypeId: EXPO_ENTITY_TYPE_ID,
    id: itemId,
  });
  return result?.item ?? result?.ITEM ?? result;
}

/** Best-effort timeline comment. Bitrix' `crm.timeline.comment.add` requires
 *  a numeric ENTITY_TYPE that maps to the smart process — we use the
 *  entityTypeId directly, which is supported on modern portals. */
export async function timelineComment(itemId: number, body: string): Promise<void> {
  try {
    await bx("crm.timeline.comment.add", {
      fields: {
        ENTITY_ID: itemId,
        ENTITY_TYPE: `DYNAMIC_${EXPO_ENTITY_TYPE_ID}`,
        COMMENT: body,
      },
    });
  } catch (err) {
    if (err instanceof BitrixWebhookRequiredError) throw err;
    // Comments are non-critical — log and continue.
    console.warn("[smartEnrichment] timeline.comment.add failed:", err);
  }
}

export function describeChange(change: { label: string; from: any; to: any }, sourceUrl?: string): string {
  const fromTxt = formatValue(change.from);
  const toTxt = formatValue(change.to);
  const tail = sourceUrl ? ` Источник: ${sourceUrl}` : "";
  return `Поле ${change.label}: ${fromTxt} → ${toTxt}.${tail}`;
}

function formatValue(v: any): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  return String(v);
}

export function maybeFillCalculated(parsed: ParseResult): ParseResult {
  if (parsed.montageStart && parsed.dismantleStart) return parsed;
  if (!parsed.beginDate || !parsed.endDate) return parsed;
  const calc = calculateDates(parsed.beginDate, parsed.endDate);
  return {
    ...parsed,
    montageStart: parsed.montageStart ?? calc.montageStart,
    montageEnd: parsed.montageEnd ?? calc.montageEnd,
    dismantleStart: parsed.dismantleStart ?? calc.dismantleStart,
    dismantleEnd: parsed.dismantleEnd ?? calc.dismantleEnd,
  };
}

export const __test__ = { FIELD_LABELS, SMART_FIELDS, SMART_FIELDS_ORIGINAL };
