import { callBx, CrmItem, listAllBx, listAllBxDetailed } from "./bitrix";
import {
  BUILD_SCHEDULE_STAGE_IDS,
  DEAL_GROUP_LABELS,
  DEAL_STATUS_ORDER,
  DealGroupKey,
  DealStatusKey,
  EXPO_DATE_FIELDS,
  EXPO_DATE_FIELDS_ORIGINAL,
  EXPO_ENTITY_TYPE_ID,
  EXPO_LINK_FIELD,
  LEAD_GROUP_LABELS,
  LeadGroupKey,
  dealExpoFieldCode,
  dealStageIds,
  fallbackDealGroup,
  fallbackLeadGroup,
  groupForDeal,
  groupForLead,
  leadExpoFieldCode,
  matchBuildScheduleStage,
  matchDealStatus,
} from "./config";
import {
  expoDateSelectCodes,
  getExpoFieldCode,
  getExpoFieldDiscovery,
  getExpoFieldsSync,
} from "./expo-fields";
import { fetchLinkedEntities, LinkFieldChoice } from "./expo-link";

export type ExpoItem = {
  id: number;
  title: string;
  assignedById?: number;
  createdTime?: string;
  updatedTime?: string;
  responsibleId?: number;
  venue?: string;
  city?: string;
  installStart?: string;
  installEnd?: string;
  expoStart?: string;
  expoEnd?: string;
  dismantleStart?: string;
  dismantleEnd?: string;
  raw: CrmItem;
};

export type LeadStats = {
  total: number;
  new: number;
  inWork: number;
  declined: number;
  success: number;
  byGroup: Record<LeadGroupKey, CrmItem[]>;
};

export type DealStats = {
  total: number;
  early: number;
  inWork: number;
  refusal: number;
  lostCompetition: number;
  won: number;
  byGroup: Record<DealGroupKey, CrmItem[]>;
};

export type ExpoAggregateDiagnostics = {
  lead: LinkFieldChoice;
  deal: LinkFieldChoice;
  errors: string[];
};

export type ExpoAggregateFound = {
  status: "found";
  expo: ExpoItem;
  leadStats: LeadStats;
  dealStats: DealStats;
  leads: CrmItem[];
  deals: CrmItem[];
  diagnostics: ExpoAggregateDiagnostics;
};

export type ExpoAggregateNotFound = {
  status: "not-found";
  expoId: string;
  diagnostics: ExpoAggregateDiagnostics;
};

export type ExpoAggregate = ExpoAggregateFound | ExpoAggregateNotFound;

export function isFoundAggregate(agg: ExpoAggregate | null | undefined): agg is ExpoAggregateFound {
  return !!agg && agg.status === "found";
}

function emptyLinkChoice(entity: "lead" | "deal"): LinkFieldChoice {
  return {
    entity,
    candidates: [],
    attempted: [],
    hasCustom: false,
    usedFallback: false,
    manualOverrideActive: false,
    manualFormatOverrideActive: false,
    warnings: [],
    totalCandidateCount: 0,
  };
}

export type StatusRef = {
  id: string;
  title: string;
  entityId?: string;
  categoryId?: string;
  sort?: number;
  source?: string;
};

const pick = (item: CrmItem, ...keys: (string | undefined)[]) => {
  for (const key of keys) {
    if (!key) continue;
    const direct = item[key];
    if (direct !== undefined && direct !== null && direct !== "") return direct;
    const upper = item[key.toUpperCase()];
    if (upper !== undefined && upper !== null && upper !== "") return upper;
    const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const camelVal = item[camel];
    if (camelVal !== undefined && camelVal !== null && camelVal !== "") return camelVal;
  }
  return undefined;
};

// Defensive date-value normalizer. Some Bitrix24 user-fields are configured
// as multiple=yes (mountStart/ufCrm8_1778070067219 was confirmed multiple in
// the live account on 2026-05-06). REST returns these as arrays; single-value
// fields return a string. Either form may also be null/undefined/"" or an
// unexpected object. We pick a single string here so the rest of the app can
// keep working with plain "YYYY-MM-DD" / ISO strings.
//
//   pickEarliest=true  → choose the earliest valid date (start fields)
//   pickEarliest=false → choose the latest valid date (end fields)
//
// Returns undefined when nothing parses — never throws.
function normalizeDateValue(
  value: unknown,
  pickEarliest: boolean,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const candidates: string[] = [];
  const push = (raw: unknown) => {
    if (raw === undefined || raw === null || raw === "") return;
    if (Array.isArray(raw)) {
      for (const r of raw) push(r);
      return;
    }
    if (typeof raw === "object") {
      // Handle shapes like { value: "..." } defensively without crashing.
      const v = (raw as Record<string, unknown>).value;
      if (v !== undefined) push(v);
      return;
    }
    candidates.push(String(raw));
  };
  push(value);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  let bestStr: string | undefined;
  let bestMs: number | undefined;
  for (const text of candidates) {
    const ms = new Date(text).getTime();
    if (!Number.isFinite(ms)) continue;
    if (bestMs === undefined) {
      bestStr = text;
      bestMs = ms;
      continue;
    }
    const better = pickEarliest ? ms < bestMs : ms > bestMs;
    if (better) {
      bestStr = text;
      bestMs = ms;
    }
  }
  // If no candidate parsed, fall back to the first non-empty string so the
  // value still flows through (formatDate handles unparseable input).
  return bestStr ?? candidates[0];
}

export function normalizeExpo(item: CrmItem): ExpoItem {
  const id = Number(item.id ?? item.ID ?? 0);
  const title = String(item.title ?? item.TITLE ?? `Выставка #${id}`);
  // Read codes through the runtime registry first (discovered codes from
  // crm.item.fields), then fall back to the static EXPO_DATE_FIELDS pins
  // (camelCase) and finally the original UF_CRM_8_* names. pick() returns
  // the first non-empty value across all of them, so the app works whether
  // the REST response uses camelCase or original UF naming, and whether or
  // not field discovery has completed.
  const expoStartRaw = pick(
    item,
    getExpoFieldCode("eventStart"),
    EXPO_DATE_FIELDS.eventStart,
    EXPO_DATE_FIELDS_ORIGINAL.eventStart,
  );
  const expoEndRaw = pick(
    item,
    getExpoFieldCode("eventEnd"),
    EXPO_DATE_FIELDS.eventEnd,
    EXPO_DATE_FIELDS_ORIGINAL.eventEnd,
  );
  const installStartRaw = pick(
    item,
    getExpoFieldCode("mountStart"),
    EXPO_DATE_FIELDS.mountStart,
    EXPO_DATE_FIELDS_ORIGINAL.mountStart,
  );
  const installEndRaw = pick(
    item,
    getExpoFieldCode("mountEnd"),
    EXPO_DATE_FIELDS.mountEnd,
    EXPO_DATE_FIELDS_ORIGINAL.mountEnd,
  );
  const dismantleStartRaw = pick(
    item,
    getExpoFieldCode("dismantleStart"),
    EXPO_DATE_FIELDS.dismantleStart,
    EXPO_DATE_FIELDS_ORIGINAL.dismantleStart,
  );
  const dismantleEndRaw = pick(
    item,
    getExpoFieldCode("dismantleEnd"),
    EXPO_DATE_FIELDS.dismantleEnd,
    EXPO_DATE_FIELDS_ORIGINAL.dismantleEnd,
  );
  const responsible = pick(item, "assignedById", "ASSIGNED_BY_ID");

  return {
    id,
    title,
    assignedById: responsible ? Number(responsible) : undefined,
    responsibleId: responsible ? Number(responsible) : undefined,
    createdTime: pick(item, "createdTime", "CREATED_TIME") as string | undefined,
    updatedTime: pick(item, "updatedTime", "UPDATED_TIME") as string | undefined,
    venue: undefined,
    city: undefined,
    installStart: normalizeDateValue(installStartRaw, true),
    installEnd: normalizeDateValue(installEndRaw, false),
    expoStart: normalizeDateValue(expoStartRaw, true),
    expoEnd: normalizeDateValue(expoEndRaw, false),
    dismantleStart: normalizeDateValue(dismantleStartRaw, true),
    dismantleEnd: normalizeDateValue(dismantleEndRaw, false),
    raw: item,
  };
}

export async function fetchExpoList(): Promise<ExpoItem[]> {
  const items = await listAllBx<CrmItem>("crm.item.list", {
    entityTypeId: EXPO_ENTITY_TYPE_ID,
    select: ["*", "ufCrm*"],
    order: { id: "DESC" },
  });
  return items.map(normalizeExpo);
}

// --- Month-scoped exhibition loader ----------------------------------------
//
// The live Bitrix24 account holds 420+ exhibitions in smart-process 1050 and
// crm.item.list paging reliably times out at ~45 s before the Gantt can
// render anything. The Gantt only shows exhibitions whose event interval
// [eventStart, eventEnd] overlaps the selected month, so there is no reason
// to load the entire list when only a handful of items are needed per month.
//
// Server-side filter rule:
//   start <= monthEnd  AND  end >= monthStart
// Bitrix filter syntax uses "<=fieldCode" / ">=fieldCode" keys. We also set
// a higher soft page cap so we can detect accidental full-loads in
// diagnostics, but typical months are a handful of rows on one page.
//
// A guarded fallback path is provided: if the optimized filter fails (e.g.
// the Bitrix account refuses the <=/>= syntax on a UF date field), the
// caller receives a structured error with the attempted filter so the UI
// can show a clear diagnostic instead of silently paging the whole set.

export type MonthExpoLoadStrategy =
  | "month-filter-merged"
  | "month-filter-full-period"
  | "month-filter-event-dates"
  | "month-filter-event-start-only"
  | "full-list-fallback";

export type MonthExpoLoadDiagnostics = {
  strategy: MonthExpoLoadStrategy;
  strategyLabel: string;
  monthKey: string;
  monthStartIso: string;
  monthEndIso: string;
  filter: Record<string, unknown>;
  select: string[];
  pagesLoaded: number;
  itemCount: number;
  durationMs: number;
  fallbackUsed: boolean;
  usedFullLoad: boolean;
  error?: string;
  timedOut?: boolean;
  attempts: Array<{
    strategy: MonthExpoLoadStrategy;
    ok: boolean;
    itemCount: number;
    pagesLoaded: number;
    durationMs: number;
    error?: string;
    timedOut?: boolean;
  }>;
  eventStartField: string;
  eventEndField: string;
  // Merge-specific diagnostics. Populated when the merged strategy ran (i.e.
  // both the event-period and full-phase queries were attempted in parallel).
  // Counts reflect rows returned by each individual query before deduplication;
  // mergedCount is the size of the deduped union; duplicateCount is the number
  // of items returned by both queries.
  eventStrategyCount?: number;
  fullPeriodStrategyCount?: number;
  mergedCount?: number;
  duplicateCount?: number;
  eventStrategyError?: string;
  fullPeriodStrategyError?: string;
  eventStrategyTimedOut?: boolean;
  fullPeriodStrategyTimedOut?: boolean;
  eventStrategyAvailable?: boolean;
  fullPeriodStrategyAvailable?: boolean;
};

export type MonthExpoLoadResult = {
  items: ExpoItem[];
  diagnostics: MonthExpoLoadDiagnostics;
};

// Build a [monthStart, monthEnd] bounds pair in the local timezone.
// monthEnd is the last millisecond of the last day so "<=" naturally
// includes exhibitions starting on the last day of the month.
export function monthBoundsIso(activeMonth: Date): {
  monthStart: Date;
  monthEnd: Date;
  monthStartIso: string;
  monthEndIso: string;
  monthKey: string;
} {
  const y = activeMonth.getFullYear();
  const m = activeMonth.getMonth();
  const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
  const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthKey = `${y}-${pad(m + 1)}`;
  // Bitrix accepts ISO-like "YYYY-MM-DD HH:mm:ss" or full ISO; ISO is safe.
  return {
    monthStart,
    monthEnd,
    monthStartIso: monthStart.toISOString(),
    monthEndIso: monthEnd.toISOString(),
    monthKey,
  };
}

// Tight select list — we only need the id/title/date fields and responsible
// assignee for filtering / display. Built dynamically so any newly-discovered
// montage/dismantle fields are included once detection completes.
function buildMonthExpoSelect(): string[] {
  // Always include all six pinned date codes so server-side returns the
  // mount/dismantle phases even before runtime field discovery completes.
  // Dynamic codes from expoDateSelectCodes() may add discovered duplicates
  // — Set deduplicates them.
  const base: Array<string | undefined> = [
    "id",
    "title",
    "assignedById",
    "createdTime",
    "updatedTime",
    EXPO_DATE_FIELDS.eventStart,
    EXPO_DATE_FIELDS.eventEnd,
    EXPO_DATE_FIELDS.mountStart,
    EXPO_DATE_FIELDS.mountEnd,
    EXPO_DATE_FIELDS.dismantleStart,
    EXPO_DATE_FIELDS.dismantleEnd,
  ];
  const dynamic = expoDateSelectCodes();
  const merged = new Set<string>(
    [...base, ...dynamic].filter((s): s is string => Boolean(s)),
  );
  return Array.from(merged);
}

// Per-attempt timeout. Kept below LIST_BX_TIMEOUT_MS (45s) so a bad first
// page frees the slot while the fallback still has time to run.
const MONTH_EXPO_REQUEST_TIMEOUT_MS = 20_000;
// Soft page cap. A month is normally <= 1 page (50 items); the cap catches
// accidental full-loads. Hard enough to surface in diagnostics.
const MONTH_EXPO_MAX_PAGES = 6;

async function tryMonthFilter(
  filter: Record<string, unknown>,
  strategy: MonthExpoLoadStrategy,
): Promise<{
  ok: boolean;
  items: CrmItem[];
  pagesLoaded: number;
  durationMs: number;
  error?: string;
  timedOut?: boolean;
}> {
  const select = buildMonthExpoSelect();
  const start = Date.now();
  try {
    const detailed = await listAllBxDetailed<CrmItem>(
      "crm.item.list",
      {
        entityTypeId: EXPO_ENTITY_TYPE_ID,
        filter,
        // Explicit minimal select — never rely on Bitrix' default "*" + "UF_*".
        select,
        // Explicit order so paging is deterministic.
        order: { id: "DESC" },
        // Explicit start so the first page is always the newest.
        start: 0,
      },
      {
        timeoutMs: MONTH_EXPO_REQUEST_TIMEOUT_MS,
        maxPages: MONTH_EXPO_MAX_PAGES,
        // Overall time budget so the UI never stays "loading" forever —
        // if the filtered call paginates slowly we abort early.
        deadlineMs: MONTH_EXPO_REQUEST_TIMEOUT_MS * 2,
      },
    );
    void strategy;
    return {
      ok: true,
      items: detailed.rows,
      pagesLoaded: detailed.pagesLoaded,
      durationMs: detailed.elapsedMs,
      timedOut: detailed.deadlineReached || undefined,
    };
  } catch (err) {
    const message = errorMessage(err);
    return {
      ok: false,
      items: [],
      pagesLoaded: 0,
      durationMs: Date.now() - start,
      error: message,
      timedOut: /timeout|таймаут/i.test(message),
    };
  }
}

// Compute the "overall" interval of an expo from whichever date fields are
// populated: earliest of (mount start, event start) and latest of (event end,
// dismantle end). Mirrors the Gantt row interval rule so the merged result
// can be sorted consistently with what the UI will show.
function expoOverallStartEnd(expo: ExpoItem): {
  start: number | undefined;
  end: number | undefined;
} {
  const candidates = (
    [expo.installStart, expo.expoStart, expo.installEnd, expo.expoEnd, expo.dismantleStart, expo.dismantleEnd] as Array<string | undefined>
  )
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (candidates.length === 0) return { start: undefined, end: undefined };
  // Earliest of montage/event starts (fallback to any earliest known date).
  const startCandidates: number[] = [];
  if (expo.installStart) startCandidates.push(new Date(expo.installStart).getTime());
  if (expo.expoStart) startCandidates.push(new Date(expo.expoStart).getTime());
  const start = startCandidates.filter(Number.isFinite).length
    ? Math.min(...startCandidates.filter(Number.isFinite))
    : Math.min(...candidates);
  // Latest of event/dismantle ends (fallback to latest known date).
  const endCandidates: number[] = [];
  if (expo.expoEnd) endCandidates.push(new Date(expo.expoEnd).getTime());
  if (expo.dismantleEnd) endCandidates.push(new Date(expo.dismantleEnd).getTime());
  const end = endCandidates.filter(Number.isFinite).length
    ? Math.max(...endCandidates.filter(Number.isFinite))
    : Math.max(...candidates);
  return { start, end };
}

function compareMergedExpos(a: ExpoItem, b: ExpoItem): number {
  const oa = expoOverallStartEnd(a);
  const ob = expoOverallStartEnd(b);
  const sa = oa.start ?? (a.expoStart ? new Date(a.expoStart).getTime() : undefined);
  const sb = ob.start ?? (b.expoStart ? new Date(b.expoStart).getTime() : undefined);
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  // Tie-break on event start.
  const ea = a.expoStart ? new Date(a.expoStart).getTime() : undefined;
  const eb = b.expoStart ? new Date(b.expoStart).getTime() : undefined;
  if (ea !== undefined && eb !== undefined && ea !== eb) return ea - eb;
  if (ea !== undefined && eb === undefined) return -1;
  if (ea === undefined && eb !== undefined) return 1;
  // Final tie-break on title (locale-aware) then id for stability.
  const tcmp = a.title.localeCompare(b.title, "ru-RU");
  if (tcmp !== 0) return tcmp;
  return a.id - b.id;
}

// Load every exhibition that touches the selected month. Two server-side
// queries run in parallel and their rows are merged by item id:
//   A) event-period overlap: eventStart <= monthEnd AND eventEnd >= monthStart
//   B) full-phase overlap:   mountStart <= monthEnd AND dismantleEnd >= monthStart
//      (only when both new fields are available)
//
// Bitrix excludes rows whose UF date is NULL from comparison filters. Older
// exhibitions only have legacy event dates populated, while newer ones may
// have only the new mount/dismantle fields. Running both queries and merging
// guarantees neither set is dropped. If one query errors or times out the
// other still wins; if both fail we fall through to the single-field
// eventStart range as a last resort.
export async function fetchExposByMonth(
  activeMonth: Date,
): Promise<MonthExpoLoadResult> {
  const { monthStart, monthEnd, monthStartIso, monthEndIso, monthKey } =
    monthBoundsIso(activeMonth);

  // Kick off field discovery before issuing any list query so the dynamic
  // select picks up the new montage/dismantle codes. Fall through silently
  // on failure — the static EXPO_DATE_FIELDS pins still work.
  try {
    await getExpoFieldDiscovery();
  } catch {
    // discovery already records the error in its own notes
  }

  const eventStart = EXPO_DATE_FIELDS.eventStart;
  const eventEnd = EXPO_DATE_FIELDS.eventEnd;
  const fields = getExpoFieldsSync();
  const mountStartCode = EXPO_DATE_FIELDS.mountStart ?? fields.mountStart?.code;
  const dismantleEndCode =
    EXPO_DATE_FIELDS.dismantleEnd ?? fields.dismantleEnd?.code;
  const fullPeriodAvailable = Boolean(mountStartCode && dismantleEndCode);

  const attempts: MonthExpoLoadDiagnostics["attempts"] = [];
  const select = buildMonthExpoSelect();
  const mergedStart = Date.now();

  // Strategy A — event period overlap (legacy event start/end UF dates).
  const eventFilter: Record<string, unknown> = {
    [`<=${eventStart}`]: monthEndIso,
    [`>=${eventEnd}`]: monthStartIso,
  };
  // Strategy B — full phase overlap (new montage/dismantle UF dates).
  const fullPeriodFilter: Record<string, unknown> | undefined =
    fullPeriodAvailable
      ? {
          [`<=${mountStartCode!}`]: monthEndIso,
          [`>=${dismantleEndCode!}`]: monthStartIso,
        }
      : undefined;

  const [eventRes, fullRes] = await Promise.all([
    tryMonthFilter(eventFilter, "month-filter-event-dates"),
    fullPeriodFilter
      ? tryMonthFilter(fullPeriodFilter, "month-filter-full-period")
      : Promise.resolve(null),
  ]);

  attempts.push({
    strategy: "month-filter-event-dates",
    ok: eventRes.ok,
    itemCount: eventRes.items.length,
    pagesLoaded: eventRes.pagesLoaded,
    durationMs: eventRes.durationMs,
    error: eventRes.error,
    timedOut: eventRes.timedOut,
  });
  if (fullRes) {
    attempts.push({
      strategy: "month-filter-full-period",
      ok: fullRes.ok,
      itemCount: fullRes.items.length,
      pagesLoaded: fullRes.pagesLoaded,
      durationMs: fullRes.durationMs,
      error: fullRes.error,
      timedOut: fullRes.timedOut,
    });
  }

  // If at least one strategy returned rows, merge them. We keep going even
  // if one strategy errored — its error is still surfaced in diagnostics.
  if (eventRes.ok || (fullRes && fullRes.ok)) {
    const seen = new Map<number, ExpoItem>();
    let duplicateCount = 0;
    const eventNormalized = eventRes.ok ? eventRes.items.map(normalizeExpo) : [];
    const fullNormalized = fullRes && fullRes.ok ? fullRes.items.map(normalizeExpo) : [];
    for (const expo of eventNormalized) {
      if (!Number.isFinite(expo.id) || expo.id <= 0) continue;
      seen.set(expo.id, expo);
    }
    for (const expo of fullNormalized) {
      if (!Number.isFinite(expo.id) || expo.id <= 0) continue;
      if (seen.has(expo.id)) {
        duplicateCount += 1;
        continue;
      }
      seen.set(expo.id, expo);
    }
    const merged = Array.from(seen.values()).sort(compareMergedExpos);

    const mergedFilter: Record<string, unknown> = {
      event: eventFilter,
      ...(fullPeriodFilter ? { fullPeriod: fullPeriodFilter } : {}),
    };
    const pagesLoaded =
      (eventRes.ok ? eventRes.pagesLoaded : 0) +
      (fullRes && fullRes.ok ? fullRes.pagesLoaded : 0);
    return {
      items: merged,
      diagnostics: {
        strategy: "month-filter-merged",
        strategyLabel:
          "Merged server-side filters: event-period overlap ∪ full-phase overlap (rows deduped by id)",
        monthKey,
        monthStartIso,
        monthEndIso,
        filter: mergedFilter,
        select,
        pagesLoaded,
        itemCount: merged.length,
        durationMs: Date.now() - mergedStart,
        fallbackUsed: !(eventRes.ok && fullRes?.ok) && fullPeriodAvailable,
        usedFullLoad: false,
        attempts,
        eventStartField: eventStart,
        eventEndField: eventEnd,
        eventStrategyAvailable: true,
        fullPeriodStrategyAvailable: fullPeriodAvailable,
        eventStrategyCount: eventRes.ok ? eventNormalized.length : 0,
        fullPeriodStrategyCount: fullRes && fullRes.ok ? fullNormalized.length : 0,
        mergedCount: merged.length,
        duplicateCount,
        eventStrategyError: eventRes.ok ? undefined : eventRes.error,
        fullPeriodStrategyError:
          fullRes && !fullRes.ok ? fullRes.error : undefined,
        eventStrategyTimedOut: eventRes.ok ? undefined : eventRes.timedOut,
        fullPeriodStrategyTimedOut:
          fullRes && !fullRes.ok ? fullRes.timedOut : undefined,
        timedOut: Boolean(
          (!eventRes.ok && eventRes.timedOut) ||
            (fullRes && !fullRes.ok && fullRes.timedOut),
        )
          ? true
          : undefined,
        error:
          !eventRes.ok || (fullRes && !fullRes.ok)
            ? [
                !eventRes.ok && eventRes.error
                  ? `event: ${eventRes.error}`
                  : undefined,
                fullRes && !fullRes.ok && fullRes.error
                  ? `full-period: ${fullRes.error}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined,
      },
    };
  }

  // Both merged-strategy queries failed — fall back to the narrower
  // single-field range on eventStart so the UI is not left empty when only
  // one date is configured or one of the >= operators is rejected.
  const startOnlyFilter: Record<string, unknown> = {
    [`>=${eventStart}`]: monthStartIso,
    [`<=${eventStart}`]: monthEndIso,
  };
  const startOnly = await tryMonthFilter(
    startOnlyFilter,
    "month-filter-event-start-only",
  );
  attempts.push({
    strategy: "month-filter-event-start-only",
    ok: startOnly.ok,
    itemCount: startOnly.items.length,
    pagesLoaded: startOnly.pagesLoaded,
    durationMs: startOnly.durationMs,
    error: startOnly.error,
    timedOut: startOnly.timedOut,
  });

  if (startOnly.ok) {
    const normalized = startOnly.items.map(normalizeExpo);
    const mS = monthStart.getTime();
    const mE = monthEnd.getTime();
    const visible = normalized
      .filter((expo) => {
        const s = expo.expoStart ? new Date(expo.expoStart).getTime() : undefined;
        const e = expo.expoEnd ? new Date(expo.expoEnd).getTime() : undefined;
        if (s === undefined && e === undefined) return false;
        const sv = s ?? e!;
        const ev = e ?? s!;
        return sv <= mE && ev >= mS;
      })
      .sort(compareMergedExpos);
    return {
      items: visible,
      diagnostics: {
        strategy: "month-filter-event-start-only",
        strategyLabel:
          "Fallback filter: eventStart within [monthStart, monthEnd] (merged event+full-period queries failed)",
        monthKey,
        monthStartIso,
        monthEndIso,
        filter: startOnlyFilter,
        select,
        pagesLoaded: startOnly.pagesLoaded,
        itemCount: visible.length,
        durationMs: startOnly.durationMs,
        fallbackUsed: true,
        usedFullLoad: false,
        attempts,
        eventStartField: eventStart,
        eventEndField: eventEnd,
        eventStrategyAvailable: true,
        fullPeriodStrategyAvailable: fullPeriodAvailable,
        eventStrategyCount: 0,
        fullPeriodStrategyCount: 0,
        mergedCount: 0,
        duplicateCount: 0,
        eventStrategyError: eventRes.error,
        fullPeriodStrategyError: fullRes?.error,
        eventStrategyTimedOut: eventRes.timedOut,
        fullPeriodStrategyTimedOut: fullRes?.timedOut,
      },
    };
  }

  // Everything failed — surface combined diagnostics.
  const combinedError = [
    eventRes.error ? `event: ${eventRes.error}` : undefined,
    fullRes?.error ? `full-period: ${fullRes.error}` : undefined,
    startOnly.error ? `start-only: ${startOnly.error}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    items: [],
    diagnostics: {
      strategy: "full-list-fallback",
      strategyLabel:
        "All filtered strategies failed — no fallback full-load was attempted to avoid timeout.",
      monthKey,
      monthStartIso,
      monthEndIso,
      filter: { event: eventFilter, ...(fullPeriodFilter ? { fullPeriod: fullPeriodFilter } : {}) },
      select,
      pagesLoaded: 0,
      itemCount: 0,
      durationMs: Date.now() - mergedStart,
      fallbackUsed: true,
      usedFullLoad: false,
      attempts,
      eventStartField: eventStart,
      eventEndField: eventEnd,
      eventStrategyAvailable: true,
      fullPeriodStrategyAvailable: fullPeriodAvailable,
      eventStrategyCount: 0,
      fullPeriodStrategyCount: 0,
      mergedCount: 0,
      duplicateCount: 0,
      eventStrategyError: eventRes.error,
      fullPeriodStrategyError: fullRes?.error,
      eventStrategyTimedOut: eventRes.timedOut,
      fullPeriodStrategyTimedOut: fullRes?.timedOut,
      error:
        combinedError ||
        "crm.item.list filtered by month returned no data and no error — check the UF date field codes.",
      timedOut: Boolean(eventRes.timedOut || fullRes?.timedOut || startOnly.timedOut),
    },
  };
}

// --- Year-scoped exhibition loader -----------------------------------------
//
// Same overlap rule as the month loader, but the bounds span Jan 1 — Dec 31
// of the requested year. Used by the Build Schedule year view so a single
// load returns every exhibition whose phases touch the year.
export function yearBoundsIso(year: number): {
  yearStart: Date;
  yearEnd: Date;
  yearStartIso: string;
  yearEndIso: string;
  yearKey: string;
} {
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  return {
    yearStart,
    yearEnd,
    yearStartIso: yearStart.toISOString(),
    yearEndIso: yearEnd.toISOString(),
    yearKey: String(year),
  };
}

export type YearExpoLoadResult = {
  items: ExpoItem[];
  diagnostics: {
    yearKey: string;
    pagesLoaded: number;
    itemCount: number;
    durationMs: number;
    error?: string;
    timedOut?: boolean;
    eventStrategyCount: number;
    fullPeriodStrategyCount: number;
    duplicateCount: number;
  };
};

export async function fetchExposByYear(year: number): Promise<YearExpoLoadResult> {
  const { yearStartIso, yearEndIso, yearKey } = yearBoundsIso(year);
  try {
    await getExpoFieldDiscovery();
  } catch {}
  const eventStart = EXPO_DATE_FIELDS.eventStart;
  const eventEnd = EXPO_DATE_FIELDS.eventEnd;
  const fields = getExpoFieldsSync();
  const mountStartCode = EXPO_DATE_FIELDS.mountStart ?? fields.mountStart?.code;
  const dismantleEndCode =
    EXPO_DATE_FIELDS.dismantleEnd ?? fields.dismantleEnd?.code;

  const eventFilter: Record<string, unknown> = {
    [`<=${eventStart}`]: yearEndIso,
    [`>=${eventEnd}`]: yearStartIso,
  };
  const fullPeriodFilter: Record<string, unknown> | undefined =
    mountStartCode && dismantleEndCode
      ? {
          [`<=${mountStartCode}`]: yearEndIso,
          [`>=${dismantleEndCode}`]: yearStartIso,
        }
      : undefined;

  const start = Date.now();
  const [eventRes, fullRes] = await Promise.all([
    tryMonthFilter(eventFilter, "month-filter-event-dates"),
    fullPeriodFilter
      ? tryMonthFilter(fullPeriodFilter, "month-filter-full-period")
      : Promise.resolve(null),
  ]);

  const seen = new Map<number, ExpoItem>();
  let duplicateCount = 0;
  const eventNormalized = eventRes.ok ? eventRes.items.map(normalizeExpo) : [];
  const fullNormalized = fullRes && fullRes.ok ? fullRes.items.map(normalizeExpo) : [];
  for (const expo of eventNormalized) {
    if (!Number.isFinite(expo.id) || expo.id <= 0) continue;
    seen.set(expo.id, expo);
  }
  for (const expo of fullNormalized) {
    if (!Number.isFinite(expo.id) || expo.id <= 0) continue;
    if (seen.has(expo.id)) {
      duplicateCount += 1;
      continue;
    }
    seen.set(expo.id, expo);
  }
  const merged = Array.from(seen.values()).sort(compareMergedExpos);
  const pagesLoaded =
    (eventRes.ok ? eventRes.pagesLoaded : 0) +
    (fullRes && fullRes.ok ? fullRes.pagesLoaded : 0);

  const errParts: string[] = [];
  if (!eventRes.ok && eventRes.error) errParts.push(`event: ${eventRes.error}`);
  if (fullRes && !fullRes.ok && fullRes.error)
    errParts.push(`full-period: ${fullRes.error}`);

  return {
    items: merged,
    diagnostics: {
      yearKey,
      pagesLoaded,
      itemCount: merged.length,
      durationMs: Date.now() - start,
      error: errParts.length ? errParts.join(" · ") : undefined,
      timedOut: Boolean(eventRes.timedOut || fullRes?.timedOut) || undefined,
      eventStrategyCount: eventNormalized.length,
      fullPeriodStrategyCount: fullNormalized.length,
      duplicateCount,
    },
  };
}

export type FetchExpoOutcome =
  | { status: "found"; expo: ExpoItem }
  | { status: "not-found" }
  | { status: "failed"; error: string };

export async function fetchExpoOutcome(id: string | number): Promise<FetchExpoOutcome> {
  try {
    const data = await callBx<{ item: CrmItem }>("crm.item.get", {
      entityTypeId: EXPO_ENTITY_TYPE_ID,
      id,
      useOriginalUfNames: "N",
    });
    if (!data?.item) return { status: "not-found" };
    return { status: "found", expo: normalizeExpo(data.item) };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchExpo(id: string | number): Promise<ExpoItem | undefined> {
  const outcome = await fetchExpoOutcome(id);
  return outcome.status === "found" ? outcome.expo : undefined;
}

export async function fetchLeadsByExpo(expoId: string | number): Promise<CrmItem[]> {
  const outcome = await fetchLinkedEntities("lead", expoId);
  return outcome.rows as CrmItem[];
}

export async function fetchDealsByExpo(expoId: string | number): Promise<CrmItem[]> {
  const outcome = await fetchLinkedEntities("deal", expoId);
  return outcome.rows as CrmItem[];
}

async function mergeWithCrmItem(
  entityTypeId: number,
  id: string | number,
  base: CrmItem | undefined,
): Promise<CrmItem | undefined> {
  try {
    const data = await callBx<{ item: CrmItem }>("crm.item.get", {
      entityTypeId,
      id,
      useOriginalUfNames: "N",
    });
    if (data?.item) return { ...(base ?? {}), ...data.item };
  } catch {}
  return base;
}
void EXPO_LINK_FIELD;

export async function fetchLeadById(id: string | number): Promise<CrmItem | undefined> {
  let base: CrmItem | undefined;
  try {
    base = await callBx<CrmItem>("crm.lead.get", { id });
  } catch {
    base = undefined;
  }
  return mergeWithCrmItem(1, id, base);
}

export async function fetchDealById(id: string | number): Promise<CrmItem | undefined> {
  let base: CrmItem | undefined;
  try {
    base = await callBx<CrmItem>("crm.deal.get", { id });
  } catch {
    base = undefined;
  }
  return mergeWithCrmItem(2, id, base);
}

export type DealProbeLookup =
  | { status: "found"; deal: CrmItem }
  | { status: "not-found" }
  | { status: "failed"; error: string };

export async function probeDealById(id: string | number): Promise<DealProbeLookup> {
  try {
    const deal = await callBx<CrmItem>("crm.deal.get", { id });
    if (!deal || (typeof deal === "object" && Object.keys(deal).length === 0)) {
      return { status: "not-found" };
    }
    return { status: "found", deal };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function computeLeadStats(leads: CrmItem[], leadStatusMap?: Map<string, string>): LeadStats {
  const byGroup: Record<LeadGroupKey, CrmItem[]> = {
    new: [],
    inWork: [],
    declined: [],
    success: [],
  };
  for (const lead of leads) {
    const statusId = pick(lead, "STATUS_ID", "statusId");
    let group = groupForLead(statusId);
    if (!group) {
      const title = leadStatusMap?.get(String(statusId ?? ""));
      group = fallbackLeadGroup(title);
    }
    byGroup[group].push(lead);
  }
  return {
    total: leads.length,
    new: byGroup.new.length,
    inWork: byGroup.inWork.length,
    declined: byGroup.declined.length,
    success: byGroup.success.length,
    byGroup,
  };
}

export function computeDealStats(deals: CrmItem[], dealStatusMap?: Map<string, string>): DealStats {
  const byGroup: Record<DealGroupKey, CrmItem[]> = {
    early: [],
    inWork: [],
    refusal: [],
    lostCompetition: [],
    won: [],
  };
  for (const deal of deals) {
    const stageId = pick(deal, "STAGE_ID", "stageId");
    let group = groupForDeal(stageId);
    if (!group) {
      const title = dealStatusMap?.get(String(stageId ?? ""));
      group = fallbackDealGroup(title);
    }
    byGroup[group].push(deal);
  }
  return {
    total: deals.length,
    early: byGroup.early.length,
    inWork: byGroup.inWork.length,
    refusal: byGroup.refusal.length,
    lostCompetition: byGroup.lostCompetition.length,
    won: byGroup.won.length,
    byGroup,
  };
}

export async function fetchLeadStatuses(): Promise<StatusRef[]> {
  try {
    const data = await callBx<Array<Record<string, unknown>>>("crm.status.list", {
      filter: { ENTITY_ID: "STATUS" },
      order: { SORT: "ASC" },
    });
    return (Array.isArray(data) ? data : []).map((row) => ({
      id: String(row.STATUS_ID ?? ""),
      title: String(row.NAME ?? row.STATUS_ID ?? ""),
      entityId: String(row.ENTITY_ID ?? ""),
    }));
  } catch {
    return [];
  }
}

function entityIdToCategoryId(entityId: string | undefined): string | undefined {
  if (!entityId) return undefined;
  if (entityId === "DEAL_STAGE") return "0";
  const match = entityId.match(/^DEAL_STAGE_(\d+)$/);
  return match ? match[1] : undefined;
}

export type DealStagesAttempt = {
  source: string;
  entityId?: string;
  categoryId?: string;
  ok: boolean;
  count: number;
  error?: string;
};

export type DealStagesDiagnostics = {
  attempts: DealStagesAttempt[];
  categoryIds: string[];
  bySource: Record<string, number>;
  byEntityId: Record<string, number>;
  errors: string[];
};

export type DealStagesResult = {
  stages: StatusRef[];
  diagnostics: DealStagesDiagnostics;
};

const MAX_FALLBACK_CATEGORY_ID = 50;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function fetchDealStagesDetailed(): Promise<DealStagesResult> {
  const stages: StatusRef[] = [];
  const diagnostics: DealStagesDiagnostics = {
    attempts: [],
    categoryIds: [],
    bySource: {},
    byEntityId: {},
    errors: [],
  };

  const add = (row: StatusRef): boolean => {
    if (!row.id) return false;
    const existing = stages.find(
      (r) => r.id === row.id && (r.entityId ?? "") === (row.entityId ?? ""),
    );
    if (existing) {
      if (row.categoryId && !existing.categoryId) existing.categoryId = row.categoryId;
      if (row.entityId && !existing.entityId) existing.entityId = row.entityId;
      if (row.sort !== undefined && existing.sort === undefined) existing.sort = row.sort;
      if (row.source && !existing.source) existing.source = row.source;
      return false;
    }
    stages.push(row);
    return true;
  };

  const recordAttempt = (attempt: DealStagesAttempt) => {
    diagnostics.attempts.push(attempt);
    if (attempt.ok && attempt.count > 0) {
      diagnostics.bySource[attempt.source] =
        (diagnostics.bySource[attempt.source] ?? 0) + attempt.count;
      if (attempt.entityId) {
        diagnostics.byEntityId[attempt.entityId] =
          (diagnostics.byEntityId[attempt.entityId] ?? 0) + attempt.count;
      }
    }
    if (!attempt.ok && attempt.error) {
      const key = attempt.entityId ?? attempt.categoryId ?? attempt.source;
      diagnostics.errors.push(`${attempt.source}[${key}]: ${attempt.error}`);
    }
  };

  // 1) crm.dealcategory.list — discover pipeline category IDs.
  const categoryIds = new Set<string>(["0"]);
  try {
    const categories = await callBx<Array<Record<string, unknown>>>(
      "crm.dealcategory.list",
      { order: { SORT: "ASC" } },
    );
    const list = Array.isArray(categories) ? categories : [];
    list.forEach((cat) => {
      const id = String(cat.ID ?? cat.id ?? "");
      if (id) categoryIds.add(id);
    });
    recordAttempt({
      source: "dealcategory.list",
      ok: true,
      count: list.length,
    });
  } catch (err) {
    recordAttempt({
      source: "dealcategory.list",
      ok: false,
      count: 0,
      error: errorMessage(err),
    });
  }
  diagnostics.categoryIds = Array.from(categoryIds).sort((a, b) => Number(a) - Number(b));

  // 2) crm.dealcategory.stage.list for every known category.
  for (const categoryId of diagnostics.categoryIds) {
    const entityId = categoryId === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${categoryId}`;
    try {
      const stagesRes = await callBx<Array<Record<string, unknown>>>(
        "crm.dealcategory.stage.list",
        { id: categoryId },
      );
      const list = Array.isArray(stagesRes) ? stagesRes : [];
      let added = 0;
      list.forEach((row) => {
        const id = String(row.STATUS_ID ?? "");
        const sortRaw = row.SORT ?? row.sort;
        if (
          add({
            id,
            title: String(row.NAME ?? row.STATUS_ID ?? ""),
            entityId,
            categoryId,
            sort:
              sortRaw !== undefined && sortRaw !== null && sortRaw !== ""
                ? Number(sortRaw)
                : undefined,
            source: "dealcategory.stage.list",
          })
        ) {
          added += 1;
        }
      });
      recordAttempt({
        source: "dealcategory.stage.list",
        entityId,
        categoryId,
        ok: true,
        count: added,
      });
    } catch (err) {
      recordAttempt({
        source: "dealcategory.stage.list",
        entityId,
        categoryId,
        ok: false,
        count: 0,
        error: errorMessage(err),
      });
    }
  }

  // 3) crm.status.entity.types — pull real entity list if the server supports it.
  const entityIds = new Set<string>();
  entityIds.add("DEAL_STAGE");
  try {
    const entities = await callBx<Array<Record<string, unknown>>>(
      "crm.status.entity.types",
      {},
    );
    const list = Array.isArray(entities) ? entities : [];
    list.forEach((row) => {
      const id = String(row.ID ?? row.id ?? "");
      if (id.startsWith("DEAL_STAGE")) entityIds.add(id);
    });
    recordAttempt({
      source: "status.entity.types",
      ok: true,
      count: list.length,
    });
  } catch (err) {
    recordAttempt({
      source: "status.entity.types",
      ok: false,
      count: 0,
      error: errorMessage(err),
    });
  }

  // 4) Add DEAL_STAGE_<categoryId> for every discovered category, plus a bounded
  // range of DEAL_STAGE_0..DEAL_STAGE_50 as a defensive fallback in case neither
  // dealcategory.list nor status.entity.types returned anything useful.
  diagnostics.categoryIds.forEach((categoryId) => {
    if (categoryId === "0") return;
    entityIds.add(`DEAL_STAGE_${categoryId}`);
  });
  for (let i = 0; i <= MAX_FALLBACK_CATEGORY_ID; i += 1) {
    entityIds.add(`DEAL_STAGE_${i}`);
  }

  // 5) crm.status.list per entityId. Catches any pipeline not surfaced above.
  for (const entityId of Array.from(entityIds).sort()) {
    try {
      const stagesRes = await callBx<Array<Record<string, unknown>>>(
        "crm.status.list",
        {
          filter: { ENTITY_ID: entityId },
          order: { SORT: "ASC" },
        },
      );
      const list = Array.isArray(stagesRes) ? stagesRes : [];
      let added = 0;
      list.forEach((row) => {
        const id = String(row.STATUS_ID ?? "");
        const sortRaw = row.SORT ?? row.sort;
        if (
          add({
            id,
            title: String(row.NAME ?? id),
            entityId,
            categoryId: entityIdToCategoryId(entityId),
            sort:
              sortRaw !== undefined && sortRaw !== null && sortRaw !== ""
                ? Number(sortRaw)
                : undefined,
            source: "status.list",
          })
        ) {
          added += 1;
        }
      });
      recordAttempt({
        source: "status.list",
        entityId,
        categoryId: entityIdToCategoryId(entityId),
        ok: true,
        count: added,
      });
    } catch (err) {
      recordAttempt({
        source: "status.list",
        entityId,
        categoryId: entityIdToCategoryId(entityId),
        ok: false,
        count: 0,
        error: errorMessage(err),
      });
    }
  }

  return { stages, diagnostics };
}

// Minimal select for crm.deal.list calls in the Gantt path. Anything not
// needed to render a bar or to diagnose stage bucketing is dropped so each
// page of 50 rows stays as small as Bitrix will serve. DATE_CREATE /
// DATE_MODIFY were removed — the Gantt never reads them. The UF link field
// is required to bucket by expo; STAGE_SEMANTIC_ID / CATEGORY_ID are kept
// only because the diagnostics panel surfaces them while operators verify
// pinned stage IDs.
const DEAL_STAGE_DIAGNOSTIC_SELECT = [
  "ID",
  "TITLE",
  "STAGE_ID",
  "STAGE_SEMANTIC_ID",
  "CATEGORY_ID",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "ASSIGNED_BY_ID",
  "COMPANY_TITLE",
  "CONTACT_NAME",
  "UF_CRM_6989BC521C964",
];

export type DealStageProbeOptions = {
  categoryId?: string | number;
  limit?: number; // max rows to collect (default 300, hard cap 500)
  // Per-page Bitrix timeout (applies to each individual crm.deal.list
  // page). Kept short so a hung page frees the slot quickly.
  perPageTimeoutMs?: number;
  // Overall time budget across all pages. When exceeded between pages,
  // paging stops and partial deals + deadlineReached=true are returned.
  deadlineMs?: number;
};

export type DealStageProbeResult = {
  deals: CrmItem[];
  pages: number;
  truncated: boolean;
  requestedLimit: number;
  categoryId?: string | number;
  error?: string;
  // Wall-clock time spent inside crm.deal.list. Surfaced in diagnostics.
  elapsedMs: number;
  // True when the overall deadlineMs was hit and paging stopped early.
  deadlineReached: boolean;
  // Per-page Bitrix timeout that was used.
  perPageTimeoutMs: number;
  // Overall time budget that was used (undefined = none).
  deadlineMs?: number;
  // The exact REST shape used — echoed here so diagnostics can show the
  // operator what the app actually sent to Bitrix.
  requestShape: {
    method: "crm.deal.list";
    order: Record<string, "ASC" | "DESC">;
    filter: Record<string, unknown>;
    select: string[];
    start: number;
    maxPages: number;
  };
};

const DEFAULT_DEAL_PROBE_PAGE_TIMEOUT_MS = 12_000;
const DEFAULT_DEAL_PROBE_DEADLINE_MS = 20_000;

export async function fetchDealsForStageProbe(
  options: DealStageProbeOptions = {},
): Promise<DealStageProbeResult> {
  const requestedLimit = Math.max(
    1,
    Math.min(500, Math.floor(options.limit ?? 300)),
  );
  const perPageTimeoutMs = Math.max(
    2_000,
    Math.floor(options.perPageTimeoutMs ?? DEFAULT_DEAL_PROBE_PAGE_TIMEOUT_MS),
  );
  const deadlineMs =
    options.deadlineMs === undefined
      ? DEFAULT_DEAL_PROBE_DEADLINE_MS
      : Math.max(perPageTimeoutMs, Math.floor(options.deadlineMs));
  const filter: Record<string, unknown> = {};
  if (options.categoryId !== undefined && options.categoryId !== "") {
    filter.CATEGORY_ID = options.categoryId;
  }

  const maxPages = Math.max(1, Math.ceil(requestedLimit / 50));
  const params = {
    order: { ID: "DESC" as const },
    filter,
    select: DEAL_STAGE_DIAGNOSTIC_SELECT,
    // Always page from the start so "recent" really means most-recent by ID.
    start: 0,
  };
  const requestShape: DealStageProbeResult["requestShape"] = {
    method: "crm.deal.list",
    order: params.order,
    filter,
    select: DEAL_STAGE_DIAGNOSTIC_SELECT,
    start: 0,
    maxPages,
  };

  const started = Date.now();
  try {
    const { rows, pagesLoaded, elapsedMs, truncated, deadlineReached } =
      await listAllBxDetailed<CrmItem>(
        "crm.deal.list",
        params,
        {
          maxPages,
          timeoutMs: perPageTimeoutMs,
          deadlineMs,
        },
      );
    const deals = rows.slice(0, requestedLimit);
    const hitRequestedLimit = rows.length >= requestedLimit;
    return {
      deals,
      pages: pagesLoaded,
      truncated: truncated || hitRequestedLimit,
      requestedLimit,
      categoryId: options.categoryId,
      elapsedMs,
      deadlineReached,
      perPageTimeoutMs,
      deadlineMs,
      requestShape,
    };
  } catch (err) {
    return {
      deals: [],
      pages: 0,
      truncated: false,
      requestedLimit,
      categoryId: options.categoryId,
      error: errorMessage(err),
      elapsedMs: Date.now() - started,
      deadlineReached: false,
      perPageTimeoutMs,
      deadlineMs,
      requestShape,
    };
  }
}

export type MonthlyDealBatchOutcome = {
  expoId: number;
  status: "ok" | "failed" | "timeout";
  deals: CrmItem[];
  error?: string;
  durationMs: number;
};

export type MonthlyDealBatchResult = {
  requestedExpoIds: number[];
  queriedExpoIds: number[];
  linkField: string;
  linkFormat: "numeric" | "string";
  outcomes: MonthlyDealBatchOutcome[];
  deals: CrmItem[];
  byExpoId: Map<number, CrmItem[]>;
  durationMs: number;
  timedOut: boolean;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
};

// Per-request Bitrix24 timeout for a single expo's deal list.
// Kept well below the SDK's own 45s ceiling so a stuck expo releases the
// concurrency slot quickly and the rest of the month can still render.
const MONTHLY_DEAL_REQUEST_TIMEOUT_MS = 12_000;
// Cap on pages for a single expo. UF_CRM_6989BC521C964 returns deals
// linked to that specific expo, so a handful of pages at most is expected.
const MONTHLY_DEAL_MAX_PAGES_PER_EXPO = 10;
// How many per-expo deal.list requests to run in parallel. Low enough to
// avoid overloading the BX24 SDK channel, high enough to keep the total
// time reasonable.
const MONTHLY_DEAL_CONCURRENCY = 3;

function extractExpoIdsFromDeal(
  deal: CrmItem,
  linkField: string,
): number[] {
  const r = deal as Record<string, unknown>;
  const raw =
    r[linkField] ??
    r[linkField.toUpperCase()] ??
    r[linkField.toLowerCase()] ??
    r[linkField.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase())];
  const values = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const out: number[] = [];
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(typeof v === "string" ? v.match(/\d+/)?.[0] ?? v : v);
    if (Number.isFinite(num) && num > 0) out.push(num);
  }
  return out;
}

async function fetchDealsForSingleExpo(
  linkField: string,
  expoId: number,
): Promise<MonthlyDealBatchOutcome> {
  const start = Date.now();
  try {
    const rows = await Promise.race<CrmItem[]>([
      listAllBx<CrmItem>(
        "crm.deal.list",
        {
          order: { ID: "DESC" },
          filter: { [linkField]: expoId },
          select: DEAL_STAGE_DIAGNOSTIC_SELECT,
        },
        {
          maxPages: MONTHLY_DEAL_MAX_PAGES_PER_EXPO,
          timeoutMs: MONTHLY_DEAL_REQUEST_TIMEOUT_MS,
        },
      ),
      new Promise<CrmItem[]>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `crm.deal.list timeout (${Math.round(
                  MONTHLY_DEAL_REQUEST_TIMEOUT_MS / 1000,
                )}s) for expo ${expoId}`,
              ),
            ),
          MONTHLY_DEAL_REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
    return {
      expoId,
      status: "ok",
      deals: rows,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = errorMessage(err);
    const isTimeout = /timeout|таймаут/i.test(message);
    return {
      expoId,
      status: isTimeout ? "timeout" : "failed",
      deals: [],
      error: message,
      durationMs: Date.now() - start,
    };
  }
}

export async function fetchMonthlyDealsForExpos(
  expoIds: Array<number | string>,
  options: { linkField?: string; concurrency?: number } = {},
): Promise<MonthlyDealBatchResult> {
  const linkField = options.linkField ?? "UF_CRM_6989BC521C964";
  const concurrency = Math.max(1, Math.min(options.concurrency ?? MONTHLY_DEAL_CONCURRENCY, 5));
  const uniqueIds = Array.from(
    new Set(
      expoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
  const start = Date.now();
  const byExpoId = new Map<number, CrmItem[]>();
  uniqueIds.forEach((id) => byExpoId.set(id, []));
  if (uniqueIds.length === 0) {
    return {
      requestedExpoIds: uniqueIds,
      queriedExpoIds: uniqueIds,
      linkField,
      linkFormat: "numeric",
      outcomes: [],
      deals: [],
      byExpoId,
      durationMs: 0,
      timedOut: false,
      successCount: 0,
      failedCount: 0,
      timeoutCount: 0,
    };
  }

  const outcomes: MonthlyDealBatchOutcome[] = new Array(uniqueIds.length);
  const allDeals: CrmItem[] = [];
  const seenDealIds = new Set<string>();

  let nextIndex = 0;
  const workers: Promise<void>[] = [];
  const run = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= uniqueIds.length) return;
      const expoId = uniqueIds[idx];
      const outcome = await fetchDealsForSingleExpo(linkField, expoId);
      outcomes[idx] = outcome;
      // Fold deals as soon as each outcome settles so partial results are
      // preserved even if later requests fail or time out.
      if (outcome.status === "ok") {
        for (const deal of outcome.deals) {
          const id = String((deal as Record<string, unknown>).ID ?? "");
          if (!id || seenDealIds.has(id)) continue;
          seenDealIds.add(id);
          allDeals.push(deal);
          const linkedExpoIds = extractExpoIdsFromDeal(deal, linkField);
          if (linkedExpoIds.length === 0) {
            const bucket = byExpoId.get(expoId);
            if (bucket) bucket.push(deal);
          } else {
            for (const linkedId of linkedExpoIds) {
              const bucket = byExpoId.get(linkedId);
              if (bucket) bucket.push(deal);
            }
          }
        }
      }
    }
  };
  for (let w = 0; w < Math.min(concurrency, uniqueIds.length); w++) {
    workers.push(run());
  }
  await Promise.all(workers);

  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const o of outcomes) {
    if (!o) continue;
    if (o.status === "ok") successCount += 1;
    else if (o.status === "timeout") timeoutCount += 1;
    else failedCount += 1;
  }

  return {
    requestedExpoIds: uniqueIds,
    queriedExpoIds: uniqueIds,
    linkField,
    linkFormat: "numeric",
    outcomes,
    deals: allDeals,
    byExpoId,
    durationMs: Date.now() - start,
    timedOut: timeoutCount > 0,
    successCount,
    failedCount,
    timeoutCount,
  };
}

// --- Stage-scan strategy for monthly Gantt deal bars -----------------------
//
// Problem: per-expo UF filter calls (fetchMonthlyDealsForExpos) consistently
// timeout in the live Bitrix24 environment for UF_CRM_6989BC521C964 — June
// 2026 diagnostics showed 24 expos queried, success=3, timeouts=21, deals=4.
//
// Strategy: the Gantt only needs bars for pinned stages signingContract (8),
// building (9), projectCompleted (WON). Rather than issuing N per-expo
// UF-filter calls, issue a small, bounded number of calls filtered by
// STAGE_ID only, then group by expo client-side using the UF field.
//
// Bitrix24's REST crm.deal.list STAGE_ID filter accepts a scalar value; it
// also accepts arrays for many fields but STAGE_ID is not guaranteed to
// support array-in syntax consistently across accounts. To stay safe we
// issue one call per pinned STAGE_ID with low concurrency (serial by
// default), merge and deduplicate by deal ID, then bucket by UF value.

const STAGE_SCAN_SELECT = DEAL_STAGE_DIAGNOSTIC_SELECT;
// Per-request timeout for a single STAGE_ID scan. Each stage is expected to
// have many more deals than one expo's UF bucket, so we allow more pages.
const STAGE_SCAN_REQUEST_TIMEOUT_MS = 20_000;
const STAGE_SCAN_MAX_PAGES_PER_STAGE = 10; // 10 * 50 = 500 deals per stage
const STAGE_SCAN_DEFAULT_CONCURRENCY = 1;

export type StageScanOutcome = {
  status: DealStatusKey;
  stageId: string;
  phase: "ok" | "failed" | "timeout";
  deals: CrmItem[];
  pages: number;
  error?: string;
  durationMs: number;
};

export type StageScanResult = {
  strategy: "stage-scan";
  linkField: string;
  requestedStageIds: Array<{ status: DealStatusKey; stageId: string | null }>;
  outcomes: StageScanOutcome[];
  deals: CrmItem[];
  byExpoId: Map<number, CrmItem[]>;
  // Deals that arrived but whose UF link value is missing or does not resolve
  // to a visible expo. Exposed for diagnostics only — they will not render.
  unlinkedDeals: CrmItem[];
  visibleExpoIds: number[];
  linkedToVisibleCount: number;
  perStageLinkedCount: Record<DealStatusKey, number>;
  durationMs: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  timedOut: boolean;
};

async function fetchDealsForSingleStage(
  status: DealStatusKey,
  stageId: string,
): Promise<StageScanOutcome> {
  const start = Date.now();
  try {
    const rows = await Promise.race<CrmItem[]>([
      listAllBx<CrmItem>(
        "crm.deal.list",
        {
          order: { ID: "DESC" },
          filter: { STAGE_ID: stageId },
          select: STAGE_SCAN_SELECT,
        },
        {
          maxPages: STAGE_SCAN_MAX_PAGES_PER_STAGE,
          timeoutMs: STAGE_SCAN_REQUEST_TIMEOUT_MS,
        },
      ),
      new Promise<CrmItem[]>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `crm.deal.list timeout (${Math.round(
                  STAGE_SCAN_REQUEST_TIMEOUT_MS / 1000,
                )}s) for STAGE_ID ${stageId}`,
              ),
            ),
          STAGE_SCAN_REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
    return {
      status,
      stageId,
      phase: "ok",
      deals: rows,
      pages: Math.max(1, Math.ceil(rows.length / 50)),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = errorMessage(err);
    const isTimeout = /timeout|таймаут/i.test(message);
    return {
      status,
      stageId,
      phase: isTimeout ? "timeout" : "failed",
      deals: [],
      pages: 0,
      error: message,
      durationMs: Date.now() - start,
    };
  }
}

export async function fetchMonthlyDealsByStageScan(
  visibleExpoIds: Array<number | string>,
  options: { linkField?: string; concurrency?: number } = {},
): Promise<StageScanResult> {
  const linkField = options.linkField ?? "UF_CRM_6989BC521C964";
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? STAGE_SCAN_DEFAULT_CONCURRENCY, 3),
  );
  const visible = Array.from(
    new Set(
      visibleExpoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
  const visibleSet = new Set(visible);

  const requested: Array<{ status: DealStatusKey; stageId: string | null }> =
    DEAL_STATUS_ORDER.map((status) => ({
      status,
      stageId: dealStageIds[status],
    }));
  const tasks = requested.filter(
    (t): t is { status: DealStatusKey; stageId: string } =>
      typeof t.stageId === "string" && t.stageId.length > 0,
  );

  const byExpoId = new Map<number, CrmItem[]>();
  visible.forEach((id) => byExpoId.set(id, []));
  const allDeals: CrmItem[] = [];
  const unlinked: CrmItem[] = [];
  const seenDealIds = new Set<string>();
  const perStageLinkedCount: Record<DealStatusKey, number> = {
    signingContract: 0,
    building: 0,
    projectCompleted: 0,
  };

  const start = Date.now();

  if (tasks.length === 0) {
    return {
      strategy: "stage-scan",
      linkField,
      requestedStageIds: requested,
      outcomes: [],
      deals: [],
      byExpoId,
      unlinkedDeals: [],
      visibleExpoIds: visible,
      linkedToVisibleCount: 0,
      perStageLinkedCount,
      durationMs: 0,
      successCount: 0,
      failedCount: 0,
      timeoutCount: 0,
      timedOut: false,
    };
  }

  const outcomes: StageScanOutcome[] = new Array(tasks.length);

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tasks.length) return;
      const task = tasks[idx];
      const outcome = await fetchDealsForSingleStage(task.status, task.stageId);
      outcomes[idx] = outcome;
      if (outcome.phase === "ok") {
        for (const deal of outcome.deals) {
          const rec = deal as Record<string, unknown>;
          const dealId = String(rec.ID ?? rec.id ?? "");
          if (!dealId || seenDealIds.has(dealId)) continue;
          seenDealIds.add(dealId);
          allDeals.push(deal);
          const linkedExpoIds = extractExpoIdsFromDeal(deal, linkField);
          let matched = false;
          for (const linkedId of linkedExpoIds) {
            if (!visibleSet.has(linkedId)) continue;
            const bucket = byExpoId.get(linkedId);
            if (bucket) {
              bucket.push(deal);
              matched = true;
            }
          }
          if (matched) perStageLinkedCount[task.status] += 1;
          else unlinked.push(deal);
        }
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const o of outcomes) {
    if (!o) continue;
    if (o.phase === "ok") successCount += 1;
    else if (o.phase === "timeout") timeoutCount += 1;
    else failedCount += 1;
  }

  let linkedToVisibleCount = 0;
  byExpoId.forEach((list) => {
    linkedToVisibleCount += list.length;
  });

  return {
    strategy: "stage-scan",
    linkField,
    requestedStageIds: requested,
    outcomes,
    deals: allDeals,
    byExpoId,
    unlinkedDeals: unlinked,
    visibleExpoIds: visible,
    linkedToVisibleCount,
    perStageLinkedCount,
    durationMs: Date.now() - start,
    successCount,
    failedCount,
    timeoutCount,
    timedOut: timeoutCount > 0,
  };
}

// --- Recent-deal-scan strategy (primary for Gantt) -------------------------
//
// Both the per-expo UF filter (fetchMonthlyDealsForExpos) and the per-pinned
// STAGE_ID scan (fetchMonthlyDealsByStageScan) time out consistently in the
// live Bitrix24 environment (12–20 s per request). The diagnostics panel's
// StageIdFinderPanel, however, reliably loads ~300 real deals quickly with
// the simplest possible shape: no filters except optional CATEGORY_ID, same
// select, order by ID DESC.
//
// Strategy: reuse that known-working shape. Scan a bounded number of recent
// deals (RECENT_DEAL_SCAN_DEFAULT_LIMIT), then client-side bucket them by
// pinned STAGE_ID (8, 9, WON) AND by the UF link field UF_CRM_6989BC521C964
// → visible expo IDs. Older deals are never visible in the current month's
// Gantt anyway, so scanning by ID DESC is a reasonable proxy for "recent
// enough to matter".
//
// This is a bounded scan — it will not page past the configured limit. If
// the Bitrix account exceeds that many deals newer than the pinned-stage
// matches, some bars may be missing. Bump the limit in code to widen the
// scan.

// Configurable page cap. Default 300 (6 pages of 50) — the known-working
// bounded scan size proved out by StageIdFinderPanel, which loaded 300
// deals in a few seconds and surfaced the target examples #2810
// (STAGE_ID 8), #3028 (STAGE_ID 9), and #3096 (WON). Hard cap 2000
// (40 pages) to keep the request bounded; raise the default in code if a
// wider scan is needed.
const RECENT_DEAL_SCAN_DEFAULT_LIMIT = 300;
const RECENT_DEAL_SCAN_HARD_CAP = 2000;

export type RecentScanOutcome = {
  status: DealStatusKey;
  stageId: string;
  phase: "ok" | "failed" | "timeout";
  deals: CrmItem[];
  pages: number;
  error?: string;
  durationMs: number;
};

export type RecentScanResult = {
  strategy: "recent-deal-scan";
  linkField: string;
  requestedStageIds: Array<{ status: DealStatusKey; stageId: string | null }>;
  outcomes: RecentScanOutcome[];
  deals: CrmItem[];
  byExpoId: Map<number, CrmItem[]>;
  unlinkedDeals: CrmItem[];
  visibleExpoIds: number[];
  linkedToVisibleCount: number;
  perStageLinkedCount: Record<DealStatusKey, number>;
  durationMs: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  timedOut: boolean;
  // Extra diagnostics specific to this strategy:
  scannedDealCount: number;
  pagesLoaded: number;
  requestedLimit: number;
  truncated: boolean;
  warning: string;
  scanError?: string;
  // Exact REST shape echoed for diagnostics.
  requestShape: DealStageProbeResult["requestShape"];
  // Timeout / deadline that were in force for this scan.
  perPageTimeoutMs: number;
  deadlineMs?: number;
  // True when the overall deadline was reached and paging stopped early.
  deadlineReached: boolean;
  // Which code path loaded the deals. When set to
  // "stageIdFinder-compatible" the scan delegated to
  // fetchDealsForStageProbe — the exact same request shape that
  // StageIdFinderPanel uses and that the live Bitrix24 account has
  // proven can return 300 deals reliably.
  scanSource: "stageIdFinder-compatible";
};

export async function fetchMonthlyDealsByRecentScan(
  visibleExpoIds: Array<number | string>,
  options: {
    linkField?: string;
    limit?: number;
    perPageTimeoutMs?: number;
    deadlineMs?: number;
  } = {},
): Promise<RecentScanResult> {
  const linkField = options.linkField ?? "UF_CRM_6989BC521C964";
  const requestedLimit = Math.max(
    50,
    Math.min(
      RECENT_DEAL_SCAN_HARD_CAP,
      Math.floor(options.limit ?? RECENT_DEAL_SCAN_DEFAULT_LIMIT),
    ),
  );
  const visible = Array.from(
    new Set(
      visibleExpoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
  const visibleSet = new Set(visible);

  const byExpoId = new Map<number, CrmItem[]>();
  visible.forEach((id) => byExpoId.set(id, []));

  const requested: Array<{ status: DealStatusKey; stageId: string | null }> =
    DEAL_STATUS_ORDER.map((status) => ({
      status,
      stageId: dealStageIds[status],
    }));
  const stageIdToStatus = new Map<string, DealStatusKey>();
  requested.forEach((r) => {
    if (r.stageId) stageIdToStatus.set(r.stageId, r.status);
  });

  const perStageLinkedCount: Record<DealStatusKey, number> = {
    signingContract: 0,
    building: 0,
    projectCompleted: 0,
  };
  const perStageOutcomeDeals: Record<DealStatusKey, CrmItem[]> = {
    signingContract: [],
    building: [],
    projectCompleted: [],
  };

  const start = Date.now();
  const warning = `Bounded recent-deal scan (crm.deal.list, order ID DESC, start=0, minimal select, per-page timeout + overall deadline): reads up to ${requestedLimit} most-recent deals, then client-side filters to pinned stages (8/9/WON) linked to visible expos. Older deals are not included; if the overall deadline is hit, partial deals are shown and diagnostics flag the timeout.`;

  let allScanned: CrmItem[] = [];
  let pagesLoaded = 0;
  let truncated = false;
  let scanError: string | undefined;
  // Delegate to fetchDealsForStageProbe so the Gantt uses the identical
  // function/request shape that StageIdFinderPanel uses. Any divergence
  // (paging, select, filter, timeout) between the two paths is eliminated
  // by reusing the single function.
  const probe = await fetchDealsForStageProbe({
    limit: requestedLimit,
    perPageTimeoutMs: options.perPageTimeoutMs,
    deadlineMs: options.deadlineMs,
  });
  if (probe.error) {
    scanError = probe.error;
  }
  allScanned = probe.deals;
  truncated = probe.truncated;
  pagesLoaded = probe.pages > 0
    ? probe.pages
    : Math.max(1, Math.ceil(allScanned.length / 50));

  const linkedDeals: CrmItem[] = [];
  const unlinkedDeals: CrmItem[] = [];
  const seenDealIds = new Set<string>();
  for (const deal of allScanned) {
    const rec = deal as Record<string, unknown>;
    const dealId = String(rec.ID ?? rec.id ?? "");
    if (!dealId || seenDealIds.has(dealId)) continue;
    seenDealIds.add(dealId);

    const rawStageId = String(rec.STAGE_ID ?? rec.stageId ?? "");
    if (!rawStageId) continue;
    const pinnedStatus =
      stageIdToStatus.get(rawStageId) ??
      stageIdToStatus.get(rawStageId.split(":").pop() ?? rawStageId);
    if (!pinnedStatus) continue;

    linkedDeals.push(deal);
    perStageOutcomeDeals[pinnedStatus].push(deal);

    const linkedExpoIds = extractExpoIdsFromDeal(deal, linkField);
    let matched = false;
    for (const linkedId of linkedExpoIds) {
      if (!visibleSet.has(linkedId)) continue;
      const bucket = byExpoId.get(linkedId);
      if (bucket) {
        bucket.push(deal);
        matched = true;
      }
    }
    if (matched) perStageLinkedCount[pinnedStatus] += 1;
    else unlinkedDeals.push(deal);
  }

  // Synthesize per-stage outcomes from the single scan so the existing
  // diagnostics panel can render the same layout as stage-scan. The whole
  // scan either succeeded or failed, so the phase reflects that.
  const phase: "ok" | "failed" | "timeout" = scanError
    ? /timeout|таймаут/i.test(scanError)
      ? "timeout"
      : "failed"
    : probe.deadlineReached
      ? "timeout"
      : "ok";
  const outcomes: RecentScanOutcome[] = requested
    .filter(
      (r): r is { status: DealStatusKey; stageId: string } =>
        typeof r.stageId === "string" && r.stageId.length > 0,
    )
    .map((r) => ({
      status: r.status,
      stageId: r.stageId,
      phase,
      deals: perStageOutcomeDeals[r.status],
      pages: phase === "ok" ? pagesLoaded : 0,
      error: scanError,
      durationMs: Date.now() - start,
    }));

  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const o of outcomes) {
    if (o.phase === "ok") successCount += 1;
    else if (o.phase === "timeout") timeoutCount += 1;
    else failedCount += 1;
  }

  let linkedToVisibleCount = 0;
  byExpoId.forEach((list) => {
    linkedToVisibleCount += list.length;
  });

  return {
    strategy: "recent-deal-scan",
    linkField,
    requestedStageIds: requested,
    outcomes,
    deals: linkedDeals,
    byExpoId,
    unlinkedDeals,
    visibleExpoIds: visible,
    linkedToVisibleCount,
    perStageLinkedCount,
    durationMs: Date.now() - start,
    successCount,
    failedCount,
    timeoutCount,
    timedOut: timeoutCount > 0,
    scannedDealCount: allScanned.length,
    pagesLoaded,
    requestedLimit,
    truncated,
    warning,
    scanError,
    scanSource: "stageIdFinder-compatible",
    requestShape: probe.requestShape,
    perPageTimeoutMs: probe.perPageTimeoutMs,
    deadlineMs: probe.deadlineMs,
    deadlineReached: probe.deadlineReached,
  };
}

export async function fetchDealStages(): Promise<StatusRef[]> {
  try {
    const { stages } = await fetchDealStagesDetailed();
    return stages;
  } catch {
    return [];
  }
}

export function statusTitleMap(list: StatusRef[]): Map<string, string> {
  const map = new Map<string, string>();
  list.forEach((row) => map.set(row.id, row.title));
  return map;
}

export function leadGroupLabel(key: LeadGroupKey) {
  return LEAD_GROUP_LABELS[key];
}

export function dealGroupLabel(key: DealGroupKey) {
  return DEAL_GROUP_LABELS[key];
}

// Overall deadline for buildExpoAggregate. Above this the per-branch
// promises are still running but we resolve with whatever has settled —
// the detail page renders an error banner with a retry button so the user
// is never stuck on an indefinite skeleton.
const BUILD_AGGREGATE_DEFAULT_DEADLINE_MS = 18_000;

function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeoutValue: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeoutValue);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(onTimeoutValue);
      },
    );
  });
}

export async function buildExpoAggregate(
  expoId: string | number,
  options: { deadlineMs?: number } = {},
): Promise<ExpoAggregate> {
  const deadlineMs = Math.max(
    5_000,
    Math.floor(options.deadlineMs ?? BUILD_AGGREGATE_DEFAULT_DEADLINE_MS),
  );
  const idStr = String(expoId);
  const aggregateStart = Date.now();
  // Use a per-branch deadline so a slow link-discovery does not stall the
  // whole detail page. Each branch resolves with a sentinel "timed out"
  // value when it overruns; the detail page then renders error UI with a
  // retry button instead of an infinite skeleton.
  const expoP = withDeadline(
    fetchExpoOutcome(expoId),
    deadlineMs,
    {
      status: "failed",
      error: `Таймаут получения карточки выставки (${Math.round(
        deadlineMs / 1000,
      )} с)`,
    } as FetchExpoOutcome,
  );
  const leadsP = withDeadline(
    fetchLinkedEntities("lead", expoId),
    deadlineMs,
    undefined,
  );
  const dealsP = withDeadline(
    fetchLinkedEntities("deal", expoId),
    deadlineMs,
    undefined,
  );
  const leadStatusesP = withDeadline(fetchLeadStatuses(), deadlineMs, []);
  const dealStagesP = withDeadline(fetchDealStages(), deadlineMs, []);

  const [expoRes, leadsRes, dealsRes, leadStatusesRes, dealStagesRes] = await Promise.allSettled([
    expoP,
    leadsP,
    dealsP,
    leadStatusesP,
    dealStagesP,
  ]);
  const errs: string[] = [];
  const elapsed = Date.now() - aggregateStart;
  if (elapsed >= deadlineMs) {
    errs.push(
      `Превышен общий бюджет агрегата (${Math.round(deadlineMs / 1000)} с) — некоторые блоки могут быть пустыми`,
    );
  }

  const leadOutcome = leadsRes.status === "fulfilled" ? leadsRes.value : undefined;
  const dealOutcome = dealsRes.status === "fulfilled" ? dealsRes.value : undefined;
  if (leadsRes.status === "rejected") {
    errs.push(`leads: ${String((leadsRes.reason as Error)?.message ?? leadsRes.reason)}`);
  }
  if (dealsRes.status === "rejected") {
    errs.push(`deals: ${String((dealsRes.reason as Error)?.message ?? dealsRes.reason)}`);
  }
  if (leadStatusesRes.status === "rejected") {
    errs.push(`lead-statuses: ${String((leadStatusesRes.reason as Error)?.message ?? leadStatusesRes.reason)}`);
  }
  if (dealStagesRes.status === "rejected") {
    errs.push(`deal-stages: ${String((dealStagesRes.reason as Error)?.message ?? dealStagesRes.reason)}`);
  }

  const leadChoice: LinkFieldChoice = leadOutcome?.choice ?? emptyLinkChoice("lead");
  const dealChoice: LinkFieldChoice = dealOutcome?.choice ?? emptyLinkChoice("deal");

  let expoError: string | undefined;
  let expo: ExpoItem | undefined;
  if (expoRes.status === "fulfilled") {
    const out = expoRes.value;
    if (out.status === "found") {
      expo = out.expo;
    } else if (out.status === "failed") {
      expoError = out.error;
    }
  } else {
    expoError = String((expoRes.reason as Error)?.message ?? expoRes.reason);
  }
  if (expoError) errs.push(`expo: ${expoError}`);

  if (typeof console !== "undefined" && errs.length) console.warn("buildExpoAggregate partial failure", errs);

  if (!expo) {
    return {
      status: "not-found",
      expoId: idStr,
      diagnostics: { lead: leadChoice, deal: dealChoice, errors: errs },
    };
  }

  const leads = (leadOutcome?.rows ?? []) as CrmItem[];
  const deals = (dealOutcome?.rows ?? []) as CrmItem[];
  const leadStatuses = leadStatusesRes.status === "fulfilled" ? leadStatusesRes.value : [];
  const dealStages = dealStagesRes.status === "fulfilled" ? dealStagesRes.value : [];

  return {
    status: "found",
    expo,
    leads,
    deals,
    leadStats: computeLeadStats(leads, statusTitleMap(leadStatuses)),
    dealStats: computeDealStats(deals, statusTitleMap(dealStages)),
    diagnostics: {
      lead: leadChoice,
      deal: dealChoice,
      errors: errs,
    },
  };
}

// --- Lightweight per-expo lead/deal counts for the Gantt row ---
// Direct, bounded crm.lead.list / crm.deal.list calls filtered by the
// known custom UF (config.leadExpoFieldCode / dealExpoFieldCode). This
// is intentionally smaller than buildExpoAggregate: no link-field probing,
// short maxPages, short deadline, narrow select. The Gantt row renders
// before counts are available; counts are advisory.

export type ExpoCountsLeadGroup = "inWork" | "declined" | "success";
export type ExpoCountsDealGroup = "inWork" | "unsuccessful" | "successful";

export type ExpoCounts = {
  expoId: number;
  leads: {
    total: number;
    inWork: number;
    declined: number;
    success: number;
    truncated: boolean;
    deadlineReached: boolean;
  };
  deals: {
    total: number;
    inWork: number;
    unsuccessful: number;
    successful: number;
    stage8: number;
    stage9: number;
    stageWon: number;
    truncated: boolean;
    deadlineReached: boolean;
  };
  partial: boolean;
  errors: { lead?: string; deal?: string };
  durationMs: number;
};

const COUNTS_PER_PAGE_TIMEOUT_MS = 20_000;
const COUNTS_DEADLINE_MS = 30_000;
const COUNTS_MAX_PAGES = 4;

function rawStageId(item: Record<string, unknown>): string {
  return String((item.STAGE_ID ?? item.stageId ?? "") as string).trim();
}
function rawLeadStatusId(item: Record<string, unknown>): string {
  return String((item.STATUS_ID ?? item.statusId ?? "") as string).trim();
}

function classifyLead(statusId: string): ExpoCountsLeadGroup | undefined {
  const g = groupForLead(statusId);
  if (!g) return undefined;
  if (g === "new" || g === "inWork") return "inWork";
  if (g === "declined") return "declined";
  if (g === "success") return "success";
  return undefined;
}

function classifyDeal(stageId: string): ExpoCountsDealGroup | undefined {
  const g = groupForDeal(stageId);
  if (!g) return undefined;
  if (g === "early" || g === "inWork") return "inWork";
  if (g === "refusal" || g === "lostCompetition") return "unsuccessful";
  if (g === "won") return "successful";
  return undefined;
}

function normalizedStageTail(stageId: string): string {
  // Bitrix often returns deal stages as "C1:8" / "C1:WON" — keep the tail.
  const tail = stageId.split(":").pop() ?? stageId;
  return tail.trim();
}

export async function fetchExpoCounts(
  expoId: string | number,
): Promise<ExpoCounts> {
  const start = Date.now();
  const numericId = Number(expoId);
  const filterValue: number | string =
    Number.isFinite(numericId) && numericId > 0 ? numericId : String(expoId);

  const counts: ExpoCounts = {
    expoId: Number.isFinite(numericId) ? numericId : 0,
    leads: {
      total: 0,
      inWork: 0,
      declined: 0,
      success: 0,
      truncated: false,
      deadlineReached: false,
    },
    deals: {
      total: 0,
      inWork: 0,
      unsuccessful: 0,
      successful: 0,
      stage8: 0,
      stage9: 0,
      stageWon: 0,
      truncated: false,
      deadlineReached: false,
    },
    partial: false,
    errors: {},
    durationMs: 0,
  };

  const leadField = leadExpoFieldCode;
  const dealField = dealExpoFieldCode;

  const leadPromise = leadField
    ? listAllBxDetailed<Record<string, unknown>>(
        "crm.lead.list",
        {
          filter: { [leadField]: filterValue },
          select: ["ID", "STATUS_ID"],
          order: { ID: "DESC" },
        },
        {
          maxPages: COUNTS_MAX_PAGES,
          timeoutMs: COUNTS_PER_PAGE_TIMEOUT_MS,
          deadlineMs: COUNTS_DEADLINE_MS,
        },
      )
    : Promise.reject(new Error("Lead UF не настроен"));

  const dealPromise = dealField
    ? listAllBxDetailed<Record<string, unknown>>(
        "crm.deal.list",
        {
          filter: { [dealField]: filterValue },
          select: ["ID", "STAGE_ID"],
          order: { ID: "DESC" },
        },
        {
          maxPages: COUNTS_MAX_PAGES,
          timeoutMs: COUNTS_PER_PAGE_TIMEOUT_MS,
          deadlineMs: COUNTS_DEADLINE_MS,
        },
      )
    : Promise.reject(new Error("Deal UF не настроен"));

  const [leadRes, dealRes] = await Promise.allSettled([leadPromise, dealPromise]);

  if (leadRes.status === "fulfilled") {
    const rows = leadRes.value.rows;
    counts.leads.total = rows.length;
    counts.leads.truncated = leadRes.value.truncated;
    counts.leads.deadlineReached = leadRes.value.deadlineReached;
    rows.forEach((row) => {
      const cls = classifyLead(rawLeadStatusId(row));
      if (cls === "inWork") counts.leads.inWork += 1;
      else if (cls === "declined") counts.leads.declined += 1;
      else if (cls === "success") counts.leads.success += 1;
    });
    if (leadRes.value.truncated || leadRes.value.deadlineReached) {
      counts.partial = true;
    }
  } else {
    counts.errors.lead =
      leadRes.reason instanceof Error
        ? leadRes.reason.message
        : String(leadRes.reason);
    counts.partial = true;
  }

  if (dealRes.status === "fulfilled") {
    const rows = dealRes.value.rows;
    counts.deals.total = rows.length;
    counts.deals.truncated = dealRes.value.truncated;
    counts.deals.deadlineReached = dealRes.value.deadlineReached;
    rows.forEach((row) => {
      const stageId = rawStageId(row);
      const cls = classifyDeal(stageId);
      if (cls === "inWork") counts.deals.inWork += 1;
      else if (cls === "unsuccessful") counts.deals.unsuccessful += 1;
      else if (cls === "successful") counts.deals.successful += 1;
      const tail = normalizedStageTail(stageId);
      if (tail === dealStageIds.signingContract) counts.deals.stage8 += 1;
      else if (tail === dealStageIds.building) counts.deals.stage9 += 1;
      else if (tail === dealStageIds.projectCompleted) counts.deals.stageWon += 1;
    });
    if (dealRes.value.truncated || dealRes.value.deadlineReached) {
      counts.partial = true;
    }
  } else {
    counts.errors.deal =
      dealRes.reason instanceof Error
        ? dealRes.reason.message
        : String(dealRes.reason);
    counts.partial = true;
  }

  counts.durationMs = Date.now() - start;
  return counts;
}

// --- Bulk counters across many expos ---------------------------------------
//
// fetchExpoCounts() is correct but expensive: each call issues two REST
// requests, so the list view (420 rows) and the Gantt fired 800+ requests
// and the per-row spinner stayed at "…" forever. The bulk loader below
// fetches leads/deals for many expos in a small number of chunks using
// Bitrix's "@" filter prefix (logical IN on a single field), then buckets
// the results client-side via the link UF value on each row.
//
// Filter shape used on each chunk:
//   filter: { "@<linkFieldCode>": [id1, id2, ...] }
//   select: minimal — only id + status/stage + the link field
//
// Concurrency is intentionally low (default 2) so the BX24 SDK channel is
// not overwhelmed by many parallel paginations. Chunk size defaults to 30
// IDs; smaller chunks limit per-page payload and let the per-page paginator
// finish inside the 12s deadline.
//
// Returns a Map<expoId, ExpoCounts> with one entry per requested ID. Expos
// for which both lead+deal calls failed get a counts entry whose `errors`
// is populated and `partial=true` so the UI can render "н/д" without
// keeping a spinner forever.

export type BulkCountsDiagnostics = {
  expoIdsRequested: number;
  chunkSize: number;
  concurrency: number;
  leadField: string | null;
  dealField: string | null;
  leadChunks: number;
  dealChunks: number;
  leadRequests: number;
  dealRequests: number;
  leadRowsLoaded: number;
  dealRowsLoaded: number;
  leadFailures: string[];
  dealFailures: string[];
  durationMs: number;
};

export type BulkCountsResult = {
  byExpoId: Map<number, ExpoCounts>;
  diagnostics: BulkCountsDiagnostics;
};

const BULK_COUNTS_CHUNK_SIZE_DEFAULT = 30;
const BULK_COUNTS_CONCURRENCY_DEFAULT = 2;
const BULK_COUNTS_PER_PAGE_TIMEOUT_MS = 12_000;
const BULK_COUNTS_DEADLINE_MS = 18_000;
const BULK_COUNTS_MAX_PAGES_PER_CHUNK = 12;

function emptyExpoCounts(expoId: number): ExpoCounts {
  return {
    expoId,
    leads: {
      total: 0,
      inWork: 0,
      declined: 0,
      success: 0,
      truncated: false,
      deadlineReached: false,
    },
    deals: {
      total: 0,
      inWork: 0,
      unsuccessful: 0,
      successful: 0,
      stage8: 0,
      stage9: 0,
      stageWon: 0,
      truncated: false,
      deadlineReached: false,
    },
    partial: false,
    errors: {},
    durationMs: 0,
  };
}

function chunkArray<T>(input: T[], size: number): T[][] {
  if (size <= 0) return [input.slice()];
  const out: T[][] = [];
  for (let i = 0; i < input.length; i += size) out.push(input.slice(i, i + size));
  return out;
}

function readLinkFieldValue(
  row: Record<string, unknown>,
  fieldCode: string,
): unknown {
  return (
    row[fieldCode] ??
    row[fieldCode.toUpperCase()] ??
    row[fieldCode.toLowerCase()] ??
    row[fieldCode.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase())]
  );
}

function expoIdsFromLinkValue(raw: unknown): number[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: number[] = [];
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const text = typeof v === "string" ? v : String(v);
    const numeric = text.match(/\d+/);
    if (!numeric) continue;
    const num = Number(numeric[0]);
    if (Number.isFinite(num) && num > 0) out.push(num);
  }
  return out;
}

async function fetchChunkRows(
  method: "crm.lead.list" | "crm.deal.list",
  fieldCode: string,
  ids: number[],
  selectFields: string[],
): Promise<{
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
  truncated: boolean;
  deadlineReached: boolean;
}> {
  try {
    const res = await listAllBxDetailed<Record<string, unknown>>(
      method,
      {
        filter: { [`@${fieldCode}`]: ids },
        select: selectFields,
        order: { ID: "DESC" },
      },
      {
        maxPages: BULK_COUNTS_MAX_PAGES_PER_CHUNK,
        timeoutMs: BULK_COUNTS_PER_PAGE_TIMEOUT_MS,
        deadlineMs: BULK_COUNTS_DEADLINE_MS,
      },
    );
    return {
      ok: true,
      rows: res.rows,
      truncated: res.truncated,
      deadlineReached: res.deadlineReached,
    };
  } catch (err) {
    return {
      ok: false,
      rows: [],
      error: err instanceof Error ? err.message : String(err),
      truncated: false,
      deadlineReached: false,
    };
  }
}

async function runChunkedRequests<T>(
  chunks: T[][],
  concurrency: number,
  worker: (chunk: T[], index: number) => Promise<void>,
): Promise<void> {
  if (chunks.length === 0) return;
  let next = 0;
  const runners: Promise<void>[] = [];
  const run = async () => {
    while (true) {
      const idx = next++;
      if (idx >= chunks.length) return;
      await worker(chunks[idx], idx);
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, chunks.length));
  for (let i = 0; i < lanes; i += 1) runners.push(run());
  await Promise.all(runners);
}

export async function fetchExpoCountsBulk(
  expoIds: Array<number | string>,
  options: {
    chunkSize?: number;
    concurrency?: number;
    leadField?: string | null;
    dealField?: string | null;
  } = {},
): Promise<BulkCountsResult> {
  const start = Date.now();
  const ids = Array.from(
    new Set(
      expoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);

  const byExpoId = new Map<number, ExpoCounts>();
  ids.forEach((id) => byExpoId.set(id, emptyExpoCounts(id)));

  const leadField =
    options.leadField === undefined ? leadExpoFieldCode : options.leadField;
  const dealField =
    options.dealField === undefined ? dealExpoFieldCode : options.dealField;
  const chunkSize = Math.max(
    1,
    Math.min(100, Math.floor(options.chunkSize ?? BULK_COUNTS_CHUNK_SIZE_DEFAULT)),
  );
  const concurrency = Math.max(
    1,
    Math.min(4, Math.floor(options.concurrency ?? BULK_COUNTS_CONCURRENCY_DEFAULT)),
  );

  const diagnostics: BulkCountsDiagnostics = {
    expoIdsRequested: ids.length,
    chunkSize,
    concurrency,
    leadField,
    dealField,
    leadChunks: 0,
    dealChunks: 0,
    leadRequests: 0,
    dealRequests: 0,
    leadRowsLoaded: 0,
    dealRowsLoaded: 0,
    leadFailures: [],
    dealFailures: [],
    durationMs: 0,
  };

  if (ids.length === 0) {
    diagnostics.durationMs = Date.now() - start;
    return { byExpoId, diagnostics };
  }

  const chunks = chunkArray(ids, chunkSize);
  diagnostics.leadChunks = leadField ? chunks.length : 0;
  diagnostics.dealChunks = dealField ? chunks.length : 0;

  const leadSelect = leadField
    ? Array.from(new Set(["ID", "STATUS_ID", leadField]))
    : null;
  const dealSelect = dealField
    ? Array.from(new Set(["ID", "STAGE_ID", dealField]))
    : null;

  const recordLeadRow = (
    row: Record<string, unknown>,
    chunkIds: number[],
  ) => {
    if (!leadField) return;
    const linked = expoIdsFromLinkValue(readLinkFieldValue(row, leadField));
    const targets = linked.length > 0 ? linked : [];
    const matched = targets.filter((tid) => byExpoId.has(tid));
    if (matched.length === 0) {
      // Fall back to chunk membership when no link-id can be parsed:
      // the row was returned by the IN filter so it must belong to one of
      // the chunk IDs. Distribute count to the first chunk id present in
      // the byExpoId map. This is a rare edge case (manual override
      // numeric IDs); we keep it for defensive rendering.
      const fallback = chunkIds.find((id) => byExpoId.has(id));
      if (fallback === undefined) return;
      const counts = byExpoId.get(fallback)!;
      counts.leads.total += 1;
      const cls = classifyLead(rawLeadStatusId(row));
      if (cls === "inWork") counts.leads.inWork += 1;
      else if (cls === "declined") counts.leads.declined += 1;
      else if (cls === "success") counts.leads.success += 1;
      return;
    }
    for (const tid of matched) {
      const counts = byExpoId.get(tid)!;
      counts.leads.total += 1;
      const cls = classifyLead(rawLeadStatusId(row));
      if (cls === "inWork") counts.leads.inWork += 1;
      else if (cls === "declined") counts.leads.declined += 1;
      else if (cls === "success") counts.leads.success += 1;
    }
  };

  const recordDealRow = (
    row: Record<string, unknown>,
    chunkIds: number[],
  ) => {
    if (!dealField) return;
    const linked = expoIdsFromLinkValue(readLinkFieldValue(row, dealField));
    const targets = linked.length > 0 ? linked : [];
    const matched = targets.filter((tid) => byExpoId.has(tid));
    const stageId = rawStageId(row);
    const tail = normalizedStageTail(stageId);
    if (matched.length === 0) {
      const fallback = chunkIds.find((id) => byExpoId.has(id));
      if (fallback === undefined) return;
      const counts = byExpoId.get(fallback)!;
      counts.deals.total += 1;
      const cls = classifyDeal(stageId);
      if (cls === "inWork") counts.deals.inWork += 1;
      else if (cls === "unsuccessful") counts.deals.unsuccessful += 1;
      else if (cls === "successful") counts.deals.successful += 1;
      if (tail === dealStageIds.signingContract) counts.deals.stage8 += 1;
      else if (tail === dealStageIds.building) counts.deals.stage9 += 1;
      else if (tail === dealStageIds.projectCompleted) counts.deals.stageWon += 1;
      return;
    }
    for (const tid of matched) {
      const counts = byExpoId.get(tid)!;
      counts.deals.total += 1;
      const cls = classifyDeal(stageId);
      if (cls === "inWork") counts.deals.inWork += 1;
      else if (cls === "unsuccessful") counts.deals.unsuccessful += 1;
      else if (cls === "successful") counts.deals.successful += 1;
      if (tail === dealStageIds.signingContract) counts.deals.stage8 += 1;
      else if (tail === dealStageIds.building) counts.deals.stage9 += 1;
      else if (tail === dealStageIds.projectCompleted) counts.deals.stageWon += 1;
    }
  };

  const markLeadFailureForChunk = (chunkIds: number[], message: string) => {
    diagnostics.leadFailures.push(message);
    for (const id of chunkIds) {
      const counts = byExpoId.get(id);
      if (!counts) continue;
      counts.partial = true;
      counts.errors.lead = counts.errors.lead
        ? `${counts.errors.lead} · ${message}`
        : message;
    }
  };

  const markDealFailureForChunk = (chunkIds: number[], message: string) => {
    diagnostics.dealFailures.push(message);
    for (const id of chunkIds) {
      const counts = byExpoId.get(id);
      if (!counts) continue;
      counts.partial = true;
      counts.errors.deal = counts.errors.deal
        ? `${counts.errors.deal} · ${message}`
        : message;
    }
  };

  const leadJob = async () => {
    if (!leadField || !leadSelect) return;
    await runChunkedRequests(chunks, concurrency, async (chunkIds) => {
      diagnostics.leadRequests += 1;
      const res = await fetchChunkRows(
        "crm.lead.list",
        leadField,
        chunkIds,
        leadSelect,
      );
      if (!res.ok) {
        markLeadFailureForChunk(
          chunkIds,
          res.error ?? "crm.lead.list failed",
        );
        return;
      }
      diagnostics.leadRowsLoaded += res.rows.length;
      for (const row of res.rows) recordLeadRow(row, chunkIds);
      if (res.truncated || res.deadlineReached) {
        for (const id of chunkIds) {
          const c = byExpoId.get(id);
          if (!c) continue;
          c.leads.truncated = c.leads.truncated || res.truncated;
          c.leads.deadlineReached =
            c.leads.deadlineReached || res.deadlineReached;
          c.partial = true;
        }
      }
    });
  };

  const dealJob = async () => {
    if (!dealField || !dealSelect) return;
    await runChunkedRequests(chunks, concurrency, async (chunkIds) => {
      diagnostics.dealRequests += 1;
      const res = await fetchChunkRows(
        "crm.deal.list",
        dealField,
        chunkIds,
        dealSelect,
      );
      if (!res.ok) {
        markDealFailureForChunk(
          chunkIds,
          res.error ?? "crm.deal.list failed",
        );
        return;
      }
      diagnostics.dealRowsLoaded += res.rows.length;
      for (const row of res.rows) recordDealRow(row, chunkIds);
      if (res.truncated || res.deadlineReached) {
        for (const id of chunkIds) {
          const c = byExpoId.get(id);
          if (!c) continue;
          c.deals.truncated = c.deals.truncated || res.truncated;
          c.deals.deadlineReached =
            c.deals.deadlineReached || res.deadlineReached;
          c.partial = true;
        }
      }
    });
  };

  if (!leadField) {
    diagnostics.leadFailures.push("Lead UF не настроен");
    for (const id of ids) {
      const c = byExpoId.get(id);
      if (c) {
        c.errors.lead = "Lead UF не настроен";
        c.partial = true;
      }
    }
  }
  if (!dealField) {
    diagnostics.dealFailures.push("Deal UF не настроен");
    for (const id of ids) {
      const c = byExpoId.get(id);
      if (c) {
        c.errors.deal = "Deal UF не настроен";
        c.partial = true;
      }
    }
  }

  await Promise.all([leadJob(), dealJob()]);
  diagnostics.durationMs = Date.now() - start;
  byExpoId.forEach((c) => {
    c.durationMs = diagnostics.durationMs;
  });
  return { byExpoId, diagnostics };
}

// --- Build-schedule deal details (Iteration 2) ------------------------------
//
// The "График застройки" tab needs full deal details (id, title, client,
// manager, budget, stage) for every deal in BUILD_SCHEDULE_STAGE_IDS that is
// linked to a visible exhibition. We reuse the same chunked `@<linkField>`
// pattern as fetchExpoCountsBulk so the worst-case is O(ceil(N/30)) REST
// requests for N visible exhibitions. Bitrix supports stacking filter keys,
// so we add `@STAGE_ID: BUILD_SCHEDULE_STAGE_IDS` to push the stage filter
// server-side as well.

export type BuildScheduleDeal = {
  id: number;
  expoIds: number[];
  title: string;
  stageId: string;
  stageTail: string;
  status: DealStatusKey | undefined;
  assignedById?: string;
  clientName?: string;
  manager?: string;
  budget?: string;
  bitrixUrl?: string;
  raw: Record<string, unknown>;
};

export type BuildScheduleDiagnostics = {
  expoIdsRequested: number;
  stageIds: string[];
  dealField: string | null;
  dealChunks: number;
  dealRequests: number;
  dealRowsLoaded: number;
  dealRowsKept: number;
  dealFailures: string[];
  durationMs: number;
  truncated: boolean;
  deadlineReached: boolean;
};

export type BuildScheduleResult = {
  byExpoId: Map<number, BuildScheduleDeal[]>;
  deals: BuildScheduleDeal[];
  diagnostics: BuildScheduleDiagnostics;
};

const BUILD_SCHEDULE_DEAL_SELECT = [
  "ID",
  "TITLE",
  "STAGE_ID",
  "ASSIGNED_BY_ID",
  "ASSIGNED_BY_NAME",
  "ASSIGNED_BY_LAST_NAME",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "COMPANY_ID",
  "COMPANY_TITLE",
  "CONTACT_ID",
  "DATE_MODIFY",
];

function readDealRowField(
  row: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    const lower = k.toLowerCase();
    if (row[lower] !== undefined && row[lower] !== null && row[lower] !== "") {
      return row[lower];
    }
    const camel = k.replace(/_([a-z])/gi, (_, c: string) => c.toUpperCase());
    if (row[camel] !== undefined && row[camel] !== null && row[camel] !== "") {
      return row[camel];
    }
  }
  return undefined;
}

function extractDealClient(row: Record<string, unknown>): string | undefined {
  const company = readDealRowField(row, "COMPANY_TITLE", "COMPANY_NAME");
  if (typeof company === "string" && company.trim()) return company.trim();
  const contact = readDealRowField(row, "CONTACT_NAME", "CONTACT_FULL_NAME");
  if (typeof contact === "string" && contact.trim()) return contact.trim();
  return undefined;
}

function extractDealManager(row: Record<string, unknown>): string | undefined {
  const name = readDealRowField(row, "ASSIGNED_BY_NAME");
  const last = readDealRowField(row, "ASSIGNED_BY_LAST_NAME");
  const parts: string[] = [];
  if (typeof name === "string" && name.trim()) parts.push(name.trim());
  if (typeof last === "string" && last.trim()) parts.push(last.trim());
  if (parts.length) return parts.join(" ");
  const id = readDealRowField(row, "ASSIGNED_BY_ID");
  if (id !== undefined && id !== null && String(id).trim()) {
    return `ID ${String(id).trim()}`;
  }
  return undefined;
}

function extractDealBudget(row: Record<string, unknown>): string | undefined {
  const amount = readDealRowField(row, "OPPORTUNITY");
  if (amount === undefined || amount === null || amount === "") return undefined;
  const currency = String(
    readDealRowField(row, "CURRENCY_ID") ?? "",
  ).trim();
  const num = Number(amount);
  const formatted = Number.isFinite(num)
    ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(num)
    : String(amount);
  return currency ? `${formatted} ${currency}` : formatted;
}

function bitrixDealUrl(id: number): string | undefined {
  const portal =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string | undefined> }).env
        ?.VITE_BITRIX_PORTAL_URL) ||
    "";
  if (!portal) return undefined;
  return `${portal.replace(/\/$/, "")}/crm/deal/details/${id}/`;
}

export async function fetchBuildScheduleDeals(
  expoIds: Array<number | string>,
  options: {
    stageIds?: string[];
    chunkSize?: number;
    concurrency?: number;
    dealField?: string | null;
  } = {},
): Promise<BuildScheduleResult> {
  const start = Date.now();
  const ids = Array.from(
    new Set(
      expoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);

  const stageIds =
    options.stageIds && options.stageIds.length > 0
      ? options.stageIds
      : BUILD_SCHEDULE_STAGE_IDS;
  const dealField =
    options.dealField === undefined ? dealExpoFieldCode : options.dealField;
  const chunkSize = Math.max(
    1,
    Math.min(100, Math.floor(options.chunkSize ?? BULK_COUNTS_CHUNK_SIZE_DEFAULT)),
  );
  const concurrency = Math.max(
    1,
    Math.min(4, Math.floor(options.concurrency ?? BULK_COUNTS_CONCURRENCY_DEFAULT)),
  );

  const byExpoId = new Map<number, BuildScheduleDeal[]>();
  ids.forEach((id) => byExpoId.set(id, []));
  const deals: BuildScheduleDeal[] = [];
  const seenDeals = new Set<number>();

  const diagnostics: BuildScheduleDiagnostics = {
    expoIdsRequested: ids.length,
    stageIds: [...stageIds],
    dealField,
    dealChunks: 0,
    dealRequests: 0,
    dealRowsLoaded: 0,
    dealRowsKept: 0,
    dealFailures: [],
    durationMs: 0,
    truncated: false,
    deadlineReached: false,
  };

  if (!dealField || ids.length === 0) {
    if (!dealField) diagnostics.dealFailures.push("Deal UF не настроен");
    diagnostics.durationMs = Date.now() - start;
    return { byExpoId, deals, diagnostics };
  }

  const select = Array.from(
    new Set([...BUILD_SCHEDULE_DEAL_SELECT, dealField]),
  );
  const chunks = chunkArray(ids, chunkSize);
  diagnostics.dealChunks = chunks.length;

  const stageWhitelist = new Set(stageIds);
  const recordRow = (row: Record<string, unknown>, chunkIds: number[]) => {
    const dealIdRaw =
      readDealRowField(row, "ID") ?? readDealRowField(row, "id");
    const dealId = Number(dealIdRaw);
    if (!Number.isFinite(dealId) || dealId <= 0) return;
    const stageRaw = String(readDealRowField(row, "STAGE_ID") ?? "").trim();
    const stageTail = stageRaw.split(":").pop() ?? stageRaw;
    // Server-side stage filter may not be supported on every account; double
    // check client-side against the caller-supplied whitelist so unexpected
    // rows are dropped quietly. We honor the user's stage selection here —
    // not the env-hardcoded build-schedule list — so custom pickers work.
    if (!stageWhitelist.has(stageRaw) && !stageWhitelist.has(stageTail)) {
      return;
    }
    const linked = expoIdsFromLinkValue(readLinkFieldValue(row, dealField));
    const expoMatches = linked.filter((tid) => byExpoId.has(tid));
    const targets = expoMatches.length > 0 ? expoMatches : [];
    if (targets.length === 0) {
      // Fallback for accounts where the link value comes back empty/encoded
      // unexpectedly: attribute to the first chunk id so the deal still
      // shows up somewhere instead of being silently lost.
      const fallback = chunkIds.find((id) => byExpoId.has(id));
      if (fallback === undefined) return;
      targets.push(fallback);
    }

    let entry: BuildScheduleDeal;
    if (seenDeals.has(dealId)) {
      const existing = deals.find((d) => d.id === dealId);
      if (!existing) return;
      for (const tid of targets) {
        if (!existing.expoIds.includes(tid)) {
          existing.expoIds.push(tid);
          byExpoId.get(tid)?.push(existing);
        }
      }
      return;
    }
    seenDeals.add(dealId);
    const title = String(readDealRowField(row, "TITLE") ?? "").trim() || `Сделка #${dealId}`;
    entry = {
      id: dealId,
      expoIds: [...targets],
      title,
      stageId: stageRaw,
      stageTail,
      status: matchDealStatus(stageRaw, title) ?? undefined,
      assignedById:
        readDealRowField(row, "ASSIGNED_BY_ID") !== undefined
          ? String(readDealRowField(row, "ASSIGNED_BY_ID"))
          : undefined,
      clientName: extractDealClient(row),
      manager: extractDealManager(row),
      budget: extractDealBudget(row),
      bitrixUrl: bitrixDealUrl(dealId),
      raw: row,
    };
    deals.push(entry);
    diagnostics.dealRowsKept += 1;
    for (const tid of targets) {
      byExpoId.get(tid)?.push(entry);
    }
  };

  await runChunkedRequests(chunks, concurrency, async (chunkIds) => {
    diagnostics.dealRequests += 1;
    try {
      const res = await listAllBxDetailed<Record<string, unknown>>(
        "crm.deal.list",
        {
          filter: {
            [`@${dealField}`]: chunkIds,
            "@STAGE_ID": stageIds,
          },
          select,
          order: { ID: "DESC" },
        },
        {
          maxPages: BULK_COUNTS_MAX_PAGES_PER_CHUNK,
          timeoutMs: BULK_COUNTS_PER_PAGE_TIMEOUT_MS,
          deadlineMs: BULK_COUNTS_DEADLINE_MS,
        },
      );
      diagnostics.dealRowsLoaded += res.rows.length;
      if (res.truncated) diagnostics.truncated = true;
      if (res.deadlineReached) diagnostics.deadlineReached = true;
      for (const row of res.rows) recordRow(row, chunkIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diagnostics.dealFailures.push(msg);
    }
  });

  diagnostics.durationMs = Date.now() - start;
  return { byExpoId, deals, diagnostics };
}

// Aggregation/filter helper exposed for tests and the BuildScheduleView so
// the visible exhibition list shrinks to only those with at least one deal.
export function filterExposWithBuildScheduleDeals(
  expos: ExpoItem[],
  byExpoId: Map<number, BuildScheduleDeal[]> | undefined,
): ExpoItem[] {
  if (!byExpoId) return [];
  return expos.filter((e) => (byExpoId.get(Number(e.id)) ?? []).length > 0);
}

// Tiny pure helper for tests: classify a stage id/tail against the build
// schedule whitelist without pulling the full deal-status matcher.
export function isBuildScheduleStage(
  stageId: string | undefined | null,
  whitelist: string[] = BUILD_SCHEDULE_STAGE_IDS,
): boolean {
  if (stageId === undefined || stageId === null) return false;
  const text = String(stageId).trim();
  if (!text) return false;
  const tail = text.split(":").pop() ?? text;
  return whitelist.includes(text) || whitelist.includes(tail);
}
