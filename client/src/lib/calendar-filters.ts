import type {
  BuildScheduleDeal,
  BuildScheduleResult,
  StatusRef,
} from "@/lib/expo-data";

export const CALENDAR_FILTER_KEYS = {
  month: "calMonth",
  stages: "calStages",
  managers: "calManagers",
  onlyWithDeals: "calWithDeals",
  includeLost: "calLost",
} as const;

export const DEFAULT_STAGE_THRESHOLD_TITLE =
  "Разработка и согласование дизайн-проекта";

export type CalendarFilterState = {
  monthKey: string;
  stageIds: string[];
  managerIds: string[];
  onlyWithDeals: boolean;
  includeLost: boolean;
  hasExplicitStages: boolean;
};

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthFromKey(value: string | null | undefined, fallback: Date): Date {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  }
  return new Date(year, month - 1, 1);
}

function csv(value: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function bool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "1" || value.toLocaleLowerCase("ru-RU") === "true";
}

export function readCalendarFilters(
  search: string,
  now = new Date(),
): CalendarFilterState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawStages = params.get(CALENDAR_FILTER_KEYS.stages);
  return {
    monthKey: monthKeyOf(
      monthFromKey(params.get(CALENDAR_FILTER_KEYS.month), now),
    ),
    stageIds: csv(rawStages),
    managerIds: csv(params.get(CALENDAR_FILTER_KEYS.managers)),
    onlyWithDeals: bool(params.get(CALENDAR_FILTER_KEYS.onlyWithDeals), true),
    includeLost: bool(params.get(CALENDAR_FILTER_KEYS.includeLost), false),
    hasExplicitStages: rawStages !== null,
  };
}

export function writeCalendarFilters(
  search: string,
  state: Omit<CalendarFilterState, "hasExplicitStages">,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(CALENDAR_FILTER_KEYS.month, state.monthKey);
  params.set(CALENDAR_FILTER_KEYS.stages, state.stageIds.join(","));
  if (state.managerIds.length > 0) {
    params.set(CALENDAR_FILTER_KEYS.managers, state.managerIds.join(","));
  } else {
    params.delete(CALENDAR_FILTER_KEYS.managers);
  }
  params.set(CALENDAR_FILTER_KEYS.onlyWithDeals, state.onlyWithDeals ? "1" : "0");
  params.set(CALENDAR_FILTER_KEYS.includeLost, state.includeLost ? "1" : "0");
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function normalizeStageTitle(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

export function isLostStage(stage: StatusRef): boolean {
  const semantic = String(stage.semantic ?? "").toUpperCase();
  if (semantic === "F" || semantic === "FAIL" || semantic === "FAILURE") {
    return true;
  }
  const title = normalizeStageTitle(stage.title);
  return [
    "проигр",
    "провален",
    "неусп",
    "отказ",
    "отмен",
    "lose",
    "lost",
    "fail",
    "apology",
  ].some((token) => title.includes(token));
}

function stageGroup(stage: StatusRef): string {
  return stage.categoryId ?? stage.entityId ?? "default";
}

function sortedGroups(stages: StatusRef[]): StatusRef[][] {
  const groups = new Map<string, StatusRef[]>();
  stages.forEach((stage) => {
    const key = stageGroup(stage);
    const group = groups.get(key) ?? [];
    group.push(stage);
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) =>
    group.slice().sort((a, b) => {
      const bySort = (a.sort ?? Number.MAX_SAFE_INTEGER) -
        (b.sort ?? Number.MAX_SAFE_INTEGER);
      return bySort || a.title.localeCompare(b.title, "ru-RU");
    }),
  );
}

export function defaultStageIdsFromThreshold(
  stages: StatusRef[],
  thresholdTitle = DEFAULT_STAGE_THRESHOLD_TITLE,
): string[] {
  const threshold = normalizeStageTitle(thresholdTitle);
  const ids: string[] = [];
  for (const group of sortedGroups(stages)) {
    const index = group.findIndex(
      (stage) => normalizeStageTitle(stage.title) === threshold,
    );
    if (index < 0) continue;
    group.slice(index).forEach((stage) => {
      if (!isLostStage(stage) && !ids.includes(stage.id)) ids.push(stage.id);
    });
  }
  return ids;
}

export function lostStageIdsForThreshold(
  stages: StatusRef[],
  thresholdTitle = DEFAULT_STAGE_THRESHOLD_TITLE,
): string[] {
  const threshold = normalizeStageTitle(thresholdTitle);
  const ids: string[] = [];
  for (const group of sortedGroups(stages)) {
    const index = group.findIndex(
      (stage) => normalizeStageTitle(stage.title) === threshold,
    );
    if (index < 0) continue;
    group.slice(index).forEach((stage) => {
      if (isLostStage(stage) && !ids.includes(stage.id)) ids.push(stage.id);
    });
  }
  return ids;
}

export function filterDealsByManagers(
  result: BuildScheduleResult | undefined,
  managerIds: string[],
): BuildScheduleResult | undefined {
  if (!result || managerIds.length === 0) return result;
  const allowed = new Set(managerIds.map(String));
  const deals = result.deals.filter((deal) =>
    allowed.has(String(deal.assignedById ?? "")),
  );
  const byExpoId = new Map<number, BuildScheduleDeal[]>();
  result.byExpoId.forEach((_rows, expoId) => byExpoId.set(expoId, []));
  deals.forEach((deal) => {
    deal.expoIds.forEach((expoId) => {
      const rows = byExpoId.get(expoId) ?? [];
      rows.push(deal);
      byExpoId.set(expoId, rows);
    });
  });
  return { ...result, deals, byExpoId };
}
