import { callBx, CrmField } from "./bitrix";
import { EXPO_DATE_FIELDS, EXPO_ENTITY_TYPE_ID } from "./config";

// ---------------------------------------------------------------------------
// Smart-process expo date-field discovery layer.
//
// Bitrix24 administrators added new montage/dismantle start+end fields to the
// "Выставки" smart-process (entityTypeId 1050). The field codes are not
// pinned in config, so we discover them at runtime by reading
// crm.item.fields(entityTypeId, useOriginalUfNames:'N') and matching field
// titles against Russian/English keyword groups ("монтаж", "демонтаж",
// "начало", "окончание", and aliases). Detected codes are merged with the
// pinned fallback in EXPO_DATE_FIELDS so existing event start/end keep
// working even when discovery fails.
//
// Read-only by design: this module never writes to Bitrix CRM. Cached for
// the lifetime of the app session via a module-scoped promise so multiple
// callers share one round-trip.
// ---------------------------------------------------------------------------

export type ExpoDateFieldKey =
  | "eventStart"
  | "eventEnd"
  | "mountStart"
  | "mountEnd"
  | "dismantleStart"
  | "dismantleEnd";

export type ExpoDateFieldInfo = {
  code: string;
  title: string;
  type?: string;
  isReadOnly: boolean;
  isImmutable: boolean;
  source: "discovered" | "fallback";
  confidence: "high" | "medium" | "low";
};

export type ExpoFieldDiscovery = {
  fields: Partial<Record<ExpoDateFieldKey, ExpoDateFieldInfo>>;
  rawFields: Record<string, CrmField>;
  notes: string[];
  loadedAt: number;
  error?: string;
};

const ru = (s?: string) => (s ?? "").toLocaleLowerCase("ru-RU");

function normalize(s: string): string {
  return ru(s)
    .replace(/ё/g, "е")
    .replace(/[()\[\].,;:!?«»"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Matcher = {
  // groups of synonyms — at least one keyword from each group must appear
  // in the haystack for the candidate to score against this matcher.
  groups: string[][];
  // bias added when the haystack contains a strict full phrase.
  exact?: string[];
  // boost when the field type is one of these.
  preferredTypes: string[];
};

const MATCHERS: Record<ExpoDateFieldKey, Matcher> = {
  eventStart: {
    groups: [
      ["проведен", "выстав", "event"],
      ["нач", "start", "дата начала"],
    ],
    exact: ["дата начала выставки", "начало выставки"],
    preferredTypes: ["date", "datetime"],
  },
  eventEnd: {
    groups: [
      ["проведен", "выстав", "event"],
      ["заверш", "оконч", "end", "конец", "дата окончания"],
    ],
    exact: [
      "дата завершения выставки",
      "дата окончания выставки",
      "окончание выставки",
    ],
    preferredTypes: ["date", "datetime"],
  },
  mountStart: {
    groups: [
      ["монтаж", "застрой", "mount", "install"],
      ["нач", "start", "дата начала"],
    ],
    exact: [
      "дата начала монтажа",
      "начало монтажа",
      "монтаж начало",
      "дата начала застройки",
    ],
    preferredTypes: ["date", "datetime"],
  },
  mountEnd: {
    groups: [
      ["монтаж", "застрой", "mount", "install"],
      ["заверш", "оконч", "end", "конец", "дата окончания"],
    ],
    exact: [
      "дата окончания монтажа",
      "дата завершения монтажа",
      "окончание монтажа",
      "дата окончания застройки",
    ],
    preferredTypes: ["date", "datetime"],
  },
  dismantleStart: {
    groups: [
      ["демонтаж", "разбор", "dismant", "teardown"],
      ["нач", "start", "дата начала"],
    ],
    exact: [
      "дата начала демонтажа",
      "начало демонтажа",
      "демонтаж начало",
    ],
    preferredTypes: ["date", "datetime"],
  },
  dismantleEnd: {
    groups: [
      ["демонтаж", "разбор", "dismant", "teardown"],
      ["заверш", "оконч", "end", "конец", "дата окончания"],
    ],
    exact: [
      "дата окончания демонтажа",
      "дата завершения демонтажа",
      "окончание демонтажа",
    ],
    preferredTypes: ["date", "datetime"],
  },
};

function buildHaystack(code: string, field: CrmField): string {
  const parts = [code, field.title, field.listLabel, field.formLabel, field.filterLabel]
    .filter(Boolean)
    .map((p) => normalize(String(p)));
  return parts.join(" ");
}

function scoreField(
  haystack: string,
  type: string | undefined,
  matcher: Matcher,
): number {
  const groupHits = matcher.groups.map((group) =>
    group.some((word) => haystack.includes(word)),
  );
  const allGroupsMatched = groupHits.every(Boolean);
  if (!allGroupsMatched) return 0;
  let score = matcher.groups.length * 10;
  if (matcher.exact) {
    for (const phrase of matcher.exact) {
      if (haystack.includes(normalize(phrase))) {
        score += 100;
        break;
      }
    }
  }
  if (matcher.preferredTypes.includes(type ?? "")) score += 5;
  return score;
}

function pickBest(
  rawFields: Record<string, CrmField>,
  matcher: Matcher,
  alreadyUsed: Set<string>,
): { code: string; title: string; type?: string; field: CrmField; score: number } | undefined {
  let best:
    | { code: string; title: string; type?: string; field: CrmField; score: number }
    | undefined;
  for (const [code, field] of Object.entries(rawFields ?? {})) {
    if (alreadyUsed.has(code)) continue;
    const haystack = buildHaystack(code, field);
    const score = scoreField(haystack, field.type, matcher);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        code,
        title: field.title ?? code,
        type: field.type,
        field,
        score,
      };
    }
  }
  return best;
}

function confidenceForScore(score: number): ExpoDateFieldInfo["confidence"] {
  if (score >= 120) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function makeFallback(
  code: string,
  rawFields: Record<string, CrmField>,
): ExpoDateFieldInfo {
  const field = rawFields?.[code];
  return {
    code,
    title: field?.title ?? code,
    type: field?.type,
    isReadOnly: Boolean(field?.isReadOnly),
    isImmutable: Boolean(field?.isImmutable),
    source: "fallback",
    confidence: "high",
  };
}

let cache: Promise<ExpoFieldDiscovery> | undefined;
let cachedValue: ExpoFieldDiscovery | undefined;

async function fetchAndDetect(): Promise<ExpoFieldDiscovery> {
  const notes: string[] = [];
  let rawFields: Record<string, CrmField> = {};
  let error: string | undefined;
  try {
    const data = await callBx<{ fields: Record<string, CrmField> }>(
      "crm.item.fields",
      {
        entityTypeId: EXPO_ENTITY_TYPE_ID,
        useOriginalUfNames: "N",
      },
    );
    rawFields = data?.fields ?? {};
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    notes.push(
      `crm.item.fields(${EXPO_ENTITY_TYPE_ID}) failed: ${error}. Используются только статические fallback-поля.`,
    );
  }

  const discovered: Partial<Record<ExpoDateFieldKey, ExpoDateFieldInfo>> = {};
  const usedCodes = new Set<string>();

  // Discovery order matters when multiple matchers could pick the same field
  // (e.g. a generic "Дата начала" without "монтаж"/"демонтаж" qualifiers
  // should NOT be claimed by the montage start matcher). We resolve by
  // running the most specific matchers first (montage/dismantle) and then
  // falling through to event start/end.
  const order: ExpoDateFieldKey[] = [
    "mountStart",
    "mountEnd",
    "dismantleStart",
    "dismantleEnd",
    "eventStart",
    "eventEnd",
  ];
  for (const key of order) {
    const matcher = MATCHERS[key];
    const best = pickBest(rawFields, matcher, usedCodes);
    if (!best) continue;
    discovered[key] = {
      code: best.code,
      title: best.title,
      type: best.type,
      isReadOnly: Boolean(best.field.isReadOnly),
      isImmutable: Boolean(best.field.isImmutable),
      source: "discovered",
      confidence: confidenceForScore(best.score),
    };
    usedCodes.add(best.code);
  }

  // Apply pinned fallbacks from config.EXPO_DATE_FIELDS only when discovery
  // did not find a code. Existing event start/end codes remain authoritative
  // even when discovery is silent — this matches "preserve existing".
  const fallbackPairs: Array<[ExpoDateFieldKey, string | undefined]> = [
    ["eventStart", EXPO_DATE_FIELDS.eventStart],
    ["eventEnd", EXPO_DATE_FIELDS.eventEnd],
    ["mountStart", EXPO_DATE_FIELDS.mountStart],
    ["mountEnd", EXPO_DATE_FIELDS.mountEnd],
    ["dismantleStart", EXPO_DATE_FIELDS.dismantleStart],
    ["dismantleEnd", EXPO_DATE_FIELDS.dismantleEnd],
  ];
  for (const [key, fallbackCode] of fallbackPairs) {
    if (discovered[key] || !fallbackCode) continue;
    discovered[key] = makeFallback(fallbackCode, rawFields);
  }

  if (!discovered.eventStart || !discovered.eventEnd) {
    notes.push(
      "Поля дат проведения выставки определены не полностью — Gantt может не отрисовать фазу проведения.",
    );
  }
  if (!discovered.mountStart && !discovered.mountEnd) {
    notes.push(
      "Поля монтажа не обнаружены и не настроены в EXPO_DATE_FIELDS.",
    );
  }
  if (!discovered.dismantleStart && !discovered.dismantleEnd) {
    notes.push(
      "Поля демонтажа не обнаружены и не настроены в EXPO_DATE_FIELDS.",
    );
  }

  const result: ExpoFieldDiscovery = {
    fields: discovered,
    rawFields,
    notes,
    loadedAt: Date.now(),
    error,
  };
  cachedValue = result;
  return result;
}

// Asynchronous getter — returns the cached discovery, or kicks off a new
// fetch the first time it is called.
export function getExpoFieldDiscovery(): Promise<ExpoFieldDiscovery> {
  if (!cache) {
    cache = fetchAndDetect().catch((err) => {
      cache = undefined; // allow retry on next call
      throw err;
    });
  }
  return cache;
}

// Synchronous accessor for code paths that must produce a request shape
// before the discovery promise has settled. Returns whatever fallback codes
// are available from EXPO_DATE_FIELDS when discovery has not completed.
export function getExpoFieldsSync(): Partial<Record<ExpoDateFieldKey, ExpoDateFieldInfo>> {
  if (cachedValue) return cachedValue.fields;
  const fallback: Partial<Record<ExpoDateFieldKey, ExpoDateFieldInfo>> = {};
  const fallbackPairs: Array<[ExpoDateFieldKey, string | undefined]> = [
    ["eventStart", EXPO_DATE_FIELDS.eventStart],
    ["eventEnd", EXPO_DATE_FIELDS.eventEnd],
    ["mountStart", EXPO_DATE_FIELDS.mountStart],
    ["mountEnd", EXPO_DATE_FIELDS.mountEnd],
    ["dismantleStart", EXPO_DATE_FIELDS.dismantleStart],
    ["dismantleEnd", EXPO_DATE_FIELDS.dismantleEnd],
  ];
  for (const [key, code] of fallbackPairs) {
    if (!code) continue;
    fallback[key] = {
      code,
      title: code,
      isReadOnly: false,
      isImmutable: false,
      source: "fallback",
      confidence: "high",
    };
  }
  return fallback;
}

// Returns just the field code or undefined. Convenience for selects /
// item readers that need a string.
export function getExpoFieldCode(key: ExpoDateFieldKey): string | undefined {
  return getExpoFieldsSync()[key]?.code;
}

// Returns the full set of known date-field codes (deduplicated) ready to be
// merged into a crm.item.list select array.
export function expoDateSelectCodes(): string[] {
  const codes = new Set<string>();
  for (const info of Object.values(getExpoFieldsSync())) {
    if (info?.code) codes.add(info.code);
  }
  return Array.from(codes);
}

// Reset entry point used by tests and by the diagnostics "перепроверить"
// button if we ever expose it. Not used in normal runtime.
export function resetExpoFieldDiscoveryCache(): void {
  cache = undefined;
  cachedValue = undefined;
}
