import { useMemo, useState, useCallback } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Link } from "wouter";
import { RefreshCw, BarChart3, CalendarDays, List as ListIcon, Search, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Shell, PageTitle, Empty, LoadingRows } from "./shell";
import { GanttTimeline, GanttDealBar } from "@/components/gantt";
import { CalendarView } from "@/components/calendar-view";
import {
  buildExpoAggregate,
  ExpoAggregate,
  ExpoItem,
  fetchDealsForStageProbe,
  fetchExpoList,
  fetchDealStages,
  fetchDealStagesDetailed,
  isFoundAggregate,
  probeDealById,
  statusTitleMap,
} from "@/lib/expo-data";
import type {
  DealProbeLookup,
  DealStageProbeResult,
  DealStagesResult,
  StatusRef,
} from "@/lib/expo-data";
import type { CrmItem } from "@/lib/bitrix";
import { formatDateRange, parseDate, formatValue } from "@/lib/format";
import { queryClient } from "@/lib/queryClient";
import { isInsideBitrix } from "@/lib/bitrix";
import {
  DEAL_STATUS_LABELS,
  DEAL_STATUS_ORDER,
  DealStatusKey,
  EXPO_DATE_FIELDS,
  candidateDealStatusByName,
  dealExpoFieldCode,
  dealStageIds,
  leadExpoFieldCode,
  matchDealStatus,
  matchDealStatusByName,
  normalizeStageText,
} from "@/lib/config";

type ViewMode = "gantt" | "calendar" | "list";
type PeriodMode = "all" | "current" | "future" | "past" | "year";

const MAX_MONTH_DEAL_ENRICH = 24; // bound on concurrent deal lookups per month

export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>("gantt");
  const [period, setPeriod] = useState<PeriodMode>("all");
  const [responsible, setResponsible] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeMonth, setActiveMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const expos = useQuery({
    queryKey: ["expo-list"],
    queryFn: fetchExpoList,
    enabled: isInsideBitrix(),
  });

  const responsibles = useMemo(() => {
    const ids = new Set<string>();
    (expos.data ?? []).forEach((expo) => {
      if (expo.responsibleId) ids.add(String(expo.responsibleId));
    });
    return Array.from(ids);
  }, [expos.data]);

  const filtered = useMemo(() => {
    const list = expos.data ?? [];
    const now = Date.now();
    const lower = search.trim().toLocaleLowerCase("ru-RU");
    return list.filter((expo) => {
      if (responsible !== "all" && String(expo.responsibleId ?? "") !== responsible) return false;
      if (lower && !expo.title.toLocaleLowerCase("ru-RU").includes(lower)) return false;
      if (period !== "all") {
        const start = expo.expoStart ? new Date(expo.expoStart).getTime() : undefined;
        const end = expo.expoEnd ? new Date(expo.expoEnd).getTime() : undefined;
        if (period === "current" && !(start && end && start <= now && now <= end)) return false;
        if (period === "future" && !(start && start > now)) return false;
        if (period === "past" && !(end && end < now)) return false;
        if (period === "year" && start) {
          const year = new Date().getFullYear();
          if (new Date(start).getFullYear() !== year) return false;
        }
      }
      return true;
    });
  }, [expos.data, responsible, search, period]);

  return (
    <Shell>
      <PageTitle
        eyebrow="Календарь"
        title="Календарь выставок"
        description="Основной рабочий экран: переключение между Gantt, Calendar и List, фильтры по периоду и ответственному, поиск."
      />

      {!isInsideBitrix() && (
        <Card className="mb-4 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="p-3 text-sm">
            Приложение запущено вне Bitrix24 (демо-режим). Данные CRM недоступны.
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[auto_auto_auto_1fr_auto]">
          <div className="flex rounded-md border p-0.5">
            <ViewButton mode="gantt" active={view} onClick={setView} icon={<BarChart3 className="h-4 w-4" />} label="Gantt" />
            <ViewButton mode="calendar" active={view} onClick={setView} icon={<CalendarDays className="h-4 w-4" />} label="Calendar" />
            <ViewButton mode="list" active={view} onClick={setView} icon={<ListIcon className="h-4 w-4" />} label="List" />
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodMode)}>
            <SelectTrigger className="w-[180px]" data-testid="select-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все периоды</SelectItem>
              <SelectItem value="current">Сейчас идут</SelectItem>
              <SelectItem value="future">Будущие</SelectItem>
              <SelectItem value="past">Прошедшие</SelectItem>
              <SelectItem value="year">Текущий год</SelectItem>
            </SelectContent>
          </Select>
          {responsibles.length > 0 && (
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger className="w-[180px]" data-testid="select-responsible"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все ответственные</SelectItem>
                {responsibles.map((id) => (
                  <SelectItem key={id} value={id}>ID {id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Поиск по названию выставки"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["expo-list"] })}
            data-testid="button-refresh"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Выставки ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {expos.isLoading ? (
            <LoadingRows />
          ) : expos.isError ? (
            <Empty text={`Ошибка Bitrix24 API: ${String((expos.error as Error)?.message ?? expos.error)}`} />
          ) : view === "gantt" ? (
            <GanttView
              expos={filtered}
              activeMonth={activeMonth}
              onMonthChange={setActiveMonth}
              emptyMessage={
                filtered.length === 0
                  ? "Выставок не найдено. Измените фильтры или добавьте элементы в смарт-процесс."
                  : undefined
              }
            />
          ) : !filtered.length ? (
            <Empty text="Выставок не найдено. Измените фильтры или добавьте элементы в смарт-процесс." />
          ) : view === "calendar" ? (
            <CalendarView expos={filtered} onSelect={(expo) => navigateToEvent(expo.id)} />
          ) : (
            <ListView expos={filtered} />
          )}
        </CardContent>
      </Card>

      {view === "gantt" && isInsideBitrix() && filtered.length > 0 ? (
        <GanttDiagnostics activeMonth={activeMonth} expos={filtered} />
      ) : null}
    </Shell>
  );
}

function ViewButton({
  mode,
  active,
  onClick,
  icon,
  label,
}: {
  mode: ViewMode;
  active: ViewMode;
  onClick: (mode: ViewMode) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const isActive = active === mode;
  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      data-testid={`view-${mode}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// An interval is usable only when at least one bound is configured AND parseable.
// When only one bound is present, treat as single-day (start == end).
// Per spec: do not invent dates — if a field is not configured/available, the
// interval is simply absent for that expo.
function intervalsOf(expo: ExpoItem): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const push = (from: unknown, to: unknown) => {
    const a = parseDate(from);
    const b = parseDate(to);
    if (!a && !b) return;
    const s = (a ?? b)!.getTime();
    const e = (b ?? a)!.getTime();
    out.push({ start: Math.min(s, e), end: Math.max(s, e) });
  };
  push(expo.installStart, expo.installEnd);
  push(expo.expoStart, expo.expoEnd);
  push(expo.dismantleStart, expo.dismantleEnd);
  return out;
}

// Overlap rule: interval [s,e] touches the month iff s <= monthEnd AND e >= monthStart.
// Expo qualifies if ANY of its (mount | event | dismantle) intervals overlaps.
function exposOverlappingMonth(expos: ExpoItem[], monthStart: Date): ExpoItem[] {
  const mStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1).getTime();
  const mEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getTime();
  return expos.filter((expo) =>
    intervalsOf(expo).some((iv) => iv.start <= mEnd && iv.end >= mStart),
  );
}

function GanttView({
  expos,
  activeMonth,
  onMonthChange,
  emptyMessage,
}: {
  expos: ExpoItem[];
  activeMonth: Date;
  onMonthChange: (d: Date) => void;
  emptyMessage?: string;
}) {
  const overlapping = useMemo(
    () => exposOverlappingMonth(expos, activeMonth),
    [expos, activeMonth],
  );
  // Cap the concurrent deal-aggregate lookups per month so the first
  // MAX_MONTH_DEAL_ENRICH rows drive enrichment, but every overlapping expo is
  // still rendered in the Gantt grid.
  const enrichTargets = useMemo(
    () => overlapping.slice(0, MAX_MONTH_DEAL_ENRICH),
    [overlapping],
  );
  const enabled = isInsideBitrix();

  const aggregates = useQueries({
    queries: enrichTargets.map((expo) => ({
      queryKey: ["expo-aggregate", expo.id],
      queryFn: () => buildExpoAggregate(expo.id),
      enabled,
      staleTime: 60_000,
    })),
  });

  const stageTitleMap = useMemo(() => {
    const map = new Map<string | number, string>();
    aggregates.forEach((q) => {
      const data = q.data as ExpoAggregate | undefined;
      if (!isFoundAggregate(data)) return;
      data.deals.forEach((deal) => {
        const stageId = deal.STAGE_ID ?? (deal as Record<string, unknown>).stageId;
        const stageTitle =
          (deal as Record<string, unknown>).STAGE_NAME ||
          (deal as Record<string, unknown>).stageName;
        if (stageId && typeof stageTitle === "string" && stageTitle) {
          map.set(String(stageId), stageTitle);
        }
      });
    });
    return map;
  }, [aggregates]);

  // Look up stage titles from crm for any rows where the deal row only has IDs.
  const stagesQuery = useQuery({
    queryKey: ["deal-stages"],
    queryFn: fetchDealStages,
    enabled,
    staleTime: 5 * 60_000,
  });
  const stageTitlesFromCrm = useMemo(
    () => statusTitleMap(stagesQuery.data ?? []),
    [stagesQuery.data],
  );

  const byExpoId = useMemo(() => {
    const out = new Map<number | string, GanttDealBar[]>();
    aggregates.forEach((q, idx) => {
      const expo = enrichTargets[idx];
      if (!expo) return;
      const data = q.data as ExpoAggregate | undefined;
      if (!isFoundAggregate(data)) return;
      const bars: GanttDealBar[] = [];
      data.deals.forEach((deal) => {
        const stageId = String(
          (deal as Record<string, unknown>).STAGE_ID ??
            (deal as Record<string, unknown>).stageId ??
            "",
        );
        const titleFromAgg = stageTitleMap.get(stageId);
        const title = titleFromAgg ?? stageTitlesFromCrm.get(stageId);
        const status = matchDealStatus(stageId, title);
        if (!status) return;
        const clientName = extractClientName(deal);
        const manager = extractManager(deal);
        const budget = extractBudget(deal);
        bars.push({
          id: String((deal as Record<string, unknown>).ID ?? (deal as Record<string, unknown>).id ?? ""),
          status,
          clientName,
          manager,
          budget,
          title: String((deal as Record<string, unknown>).TITLE ?? ""),
        });
      });
      // Order by configured status order so colors stack consistently.
      bars.sort((a, b) => DEAL_STATUS_ORDER.indexOf(a.status) - DEAL_STATUS_ORDER.indexOf(b.status));
      out.set(expo.id, bars);
    });
    return out;
  }, [aggregates, enrichTargets, stageTitleMap, stageTitlesFromCrm]);

  const dealsFor = useCallback(
    (expo: ExpoItem): GanttDealBar[] => byExpoId.get(expo.id) ?? [],
    [byExpoId],
  );

  const effectiveEmpty =
    emptyMessage ??
    (expos.length === 0
      ? "Выставок не найдено. Измените фильтры или добавьте элементы в смарт-процесс."
      : "Ни одна выставка не попадает в выбранный месяц (по периодам монтажа / проведения / демонтажа).");

  return (
    <GanttTimeline
      expos={overlapping}
      onSelect={(expo) => navigateToEvent(expo.id)}
      renderRight={(expo) => <StatsMini expoId={expo.id} />}
      dealsFor={dealsFor}
      initialMonth={activeMonth}
      onMonthChange={onMonthChange}
      emptyMessage={effectiveEmpty}
    />
  );
}

function extractClientName(deal: Record<string, unknown>): string | undefined {
  const fromCompany =
    deal.COMPANY_TITLE ?? deal.companyTitle ?? deal.COMPANY_NAME ?? deal.companyName;
  if (typeof fromCompany === "string" && fromCompany) return fromCompany;
  const fromContact = deal.CONTACT_NAME ?? deal.contactName;
  if (typeof fromContact === "string" && fromContact) return fromContact;
  const fromTitle = deal.TITLE ?? deal.title;
  return typeof fromTitle === "string" && fromTitle ? fromTitle : undefined;
}

function extractManager(deal: Record<string, unknown>): string | undefined {
  const name =
    deal.ASSIGNED_BY_NAME ??
    deal.assignedByName ??
    deal.ASSIGNED_BY_FULL_NAME ??
    deal.assignedByFullName;
  if (typeof name === "string" && name) return name;
  const id = deal.ASSIGNED_BY_ID ?? deal.assignedById;
  if (id !== undefined && id !== null && id !== "") return `ID ${id}`;
  return undefined;
}

function extractBudget(deal: Record<string, unknown>): string | undefined {
  const amount = deal.OPPORTUNITY ?? deal.opportunity;
  if (amount === undefined || amount === null || amount === "") return undefined;
  const currency = String(deal.CURRENCY_ID ?? deal.currencyId ?? "").trim();
  const num = Number(amount);
  const formatted = Number.isFinite(num)
    ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(num)
    : String(amount);
  return currency ? `${formatted} ${currency}` : formatted;
}

function GanttDiagnostics({
  activeMonth,
  expos,
}: {
  activeMonth: Date;
  expos: ExpoItem[];
}) {
  const enabled = isInsideBitrix();
  const stagesQuery = useQuery<DealStagesResult>({
    queryKey: ["deal-stages-detailed"],
    queryFn: fetchDealStagesDetailed,
    enabled,
    staleTime: 5 * 60_000,
  });
  const stages = stagesQuery.data?.stages ?? [];
  const stagesDiagnostics = stagesQuery.data?.diagnostics;

  // Reuse the same query keys as GanttView — React Query dedupes by key so the
  // aggregates are not refetched, just read from cache.
  const monthTargets = useMemo(
    () => exposOverlappingMonth(expos, activeMonth).slice(0, MAX_MONTH_DEAL_ENRICH),
    [expos, activeMonth],
  );
  const monthAggregates = useQueries({
    queries: monthTargets.map((expo) => ({
      queryKey: ["expo-aggregate", expo.id],
      queryFn: () => buildExpoAggregate(expo.id),
      enabled,
      staleTime: 60_000,
    })),
  });
  const crmStageTitles = useMemo(() => statusTitleMap(stages), [stages]);

  const matches: Record<DealStatusKey, { count: number; examples: { id: string; title: string }[] }> = {
    signingContract: { count: 0, examples: [] },
    building: { count: 0, examples: [] },
    projectCompleted: { count: 0, examples: [] },
  };
  stages.forEach((stage) => {
    const status = matchDealStatus(stage.id, stage.title);
    if (!status) return;
    matches[status].count += 1;
    if (matches[status].examples.length < 3) {
      matches[status].examples.push({ id: stage.id, title: stage.title });
    }
  });

  const monthLabel = activeMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const visibleCount = exposOverlappingMonth(expos, activeMonth).length;
  const totalCount = expos.length;
  const excludedNoOverlap = Math.max(0, totalCount - visibleCount);
  const mountMissing = !EXPO_DATE_FIELDS.mountStart && !EXPO_DATE_FIELDS.mountEnd;
  const dismantleMissing = !EXPO_DATE_FIELDS.dismantleStart && !EXPO_DATE_FIELDS.dismantleEnd;

  return (
    <Card className="mt-4" data-testid="gantt-diagnostics">
      <CardHeader>
        <CardTitle className="text-base">Диагностика Gantt</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid gap-1">
          <div>
            Активный месяц: <b>{monthLabel}</b> · показано в Gantt:{" "}
            <b data-testid="gantt-diag-visible">{visibleCount}</b> из{" "}
            <b data-testid="gantt-diag-total">{totalCount}</b> · скрыто (нет пересечения
            с месяцем либо нет дат):{" "}
            <b data-testid="gantt-diag-excluded">{excludedNoOverlap}</b>
          </div>
          <div className="text-muted-foreground">
            Правило отбора: интервал <i>[начало, конец]</i> пересекает месяц, если
            <code className="mx-1">начало ≤ конец месяца</code> и
            <code className="mx-1">конец ≥ начало месяца</code>. Учитываются периоды
            монтажа, проведения и демонтажа; одиночная дата трактуется как
            <code className="mx-1">начало = конец</code>. Если поле монтажа/демонтажа
            не настроено или не заполнено — интервал просто игнорируется.
          </div>
          <div>
            Lead UF: <code>{leadExpoFieldCode ?? "—"}</code> · Deal UF:{" "}
            <code>{dealExpoFieldCode ?? "—"}</code>
          </div>
          <div>
            Event start UF: <code>{EXPO_DATE_FIELDS.eventStart}</code> · end:{" "}
            <code>{EXPO_DATE_FIELDS.eventEnd}</code>
          </div>
          <div>
            Montage: <code>{EXPO_DATE_FIELDS.mountStart ?? "—"}</code> →{" "}
            <code>{EXPO_DATE_FIELDS.mountEnd ?? "—"}</code> · Dismantle:{" "}
            <code>{EXPO_DATE_FIELDS.dismantleStart ?? "—"}</code> →{" "}
            <code>{EXPO_DATE_FIELDS.dismantleEnd ?? "—"}</code>
          </div>
        </div>

        {(mountMissing || dismantleMissing) && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {mountMissing ? "Поля монтажа не настроены в EXPO_DATE_FIELDS. " : null}
            {dismantleMissing ? "Поля демонтажа не настроены в EXPO_DATE_FIELDS. " : null}
            Фазы монтажа/демонтажа будут пустыми — видно только фон проведения.
          </div>
        )}

        <div className="grid gap-2">
          <div className="font-medium">Сопоставление статусов сделок</div>
          {DEAL_STATUS_ORDER.map((key) => {
            const pinned = dealStageIds[key];
            const matched = matches[key];
            return (
              <div key={key} className="rounded-md border bg-muted/30 p-2">
                <div className="flex items-center justify-between">
                  <span>
                    <b>{DEAL_STATUS_LABELS[key]}</b>
                  </span>
                  <span className="text-muted-foreground">
                    pinned ID:{" "}
                    <code>{pinned ?? "—"}</code>
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  Совпадений по названию стадии: <b>{matched.count}</b>
                  {matched.examples.length > 0 ? (
                    <>
                      {" "}· примеры:{" "}
                      {matched.examples
                        .map((e) => `${e.id}=${e.title}`)
                        .join("; ")}
                    </>
                  ) : null}
                </div>
                {!pinned && matched.count === 0 && (
                  <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-1 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    Ни pinned ID, ни название не совпадают. Цветные бары не будут
                    показаны, если в загруженных сделках тоже нет совпадения по
                    названию стадии.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {stagesQuery.isError && (
          <div className="text-red-600">
            Ошибка загрузки стадий: {formatValue((stagesQuery.error as Error)?.message ?? stagesQuery.error)}
          </div>
        )}

        {stagesDiagnostics && (
          <StageFetchDiagnostics diagnostics={stagesDiagnostics} totalStages={stages.length} />
        )}

        <LoadedDealStagesPanel
          aggregates={monthAggregates}
          targets={monthTargets}
          crmStageTitles={crmStageTitles}
        />

        <StageIdFinderPanel crmStageTitles={crmStageTitles} />

        <AllDealStagesTable stages={stages} />
      </CardContent>
    </Card>
  );
}

type LoadedDealRow = {
  expoId: number;
  expoTitle: string;
  dealId: string;
  dealTitle: string;
  stageId: string;
  stageTitleCrm?: string;
  stageSemanticId?: string;
  categoryId?: string;
  opportunity?: string;
  currencyId?: string;
  clientName?: string;
  assignedById?: string;
  linkFieldCode?: string;
  linkFieldValue?: string;
  candidate?: DealStatusKey;
  exact?: DealStatusKey;
};

function extractLinkFieldValue(
  deal: Record<string, unknown>,
  fieldCode: string | undefined,
): string | undefined {
  if (!fieldCode) return undefined;
  const variants = [
    fieldCode,
    fieldCode.toUpperCase(),
    fieldCode.toLowerCase(),
    fieldCode.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase()),
  ];
  for (const key of variants) {
    const v = deal[key];
    if (v !== undefined && v !== null && v !== "") {
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
  }
  return undefined;
}

function collectLoadedDealRows(
  aggregates: { data?: ExpoAggregate }[],
  targets: ExpoItem[],
  crmStageTitles: Map<string, string>,
): LoadedDealRow[] {
  const out: LoadedDealRow[] = [];
  aggregates.forEach((q, idx) => {
    const expo = targets[idx];
    if (!expo) return;
    const data = q.data as ExpoAggregate | undefined;
    if (!isFoundAggregate(data)) return;
    const linkField = data.diagnostics.deal.chosenField ?? dealExpoFieldCode ?? undefined;
    data.deals.forEach((deal) => {
      const r = deal as Record<string, unknown>;
      const dealId = String(r.ID ?? r.id ?? "");
      if (!dealId) return;
      const stageId = String(r.STAGE_ID ?? r.stageId ?? "");
      const stageTitleCrm = stageId ? crmStageTitles.get(stageId) : undefined;
      const stageSemanticId = r.STAGE_SEMANTIC_ID
        ? String(r.STAGE_SEMANTIC_ID)
        : r.stageSemanticId
          ? String(r.stageSemanticId)
          : undefined;
      const categoryId = r.CATEGORY_ID
        ? String(r.CATEGORY_ID)
        : r.categoryId
          ? String(r.categoryId)
          : undefined;
      const opportunityRaw = r.OPPORTUNITY ?? r.opportunity;
      const opportunity =
        opportunityRaw !== undefined && opportunityRaw !== null && opportunityRaw !== ""
          ? String(opportunityRaw)
          : undefined;
      const currencyId = r.CURRENCY_ID
        ? String(r.CURRENCY_ID)
        : r.currencyId
          ? String(r.currencyId)
          : undefined;
      const exact = matchDealStatus(stageId, stageTitleCrm);
      const candidate = exact ?? candidateDealStatusByName(stageTitleCrm);
      out.push({
        expoId: expo.id,
        expoTitle: expo.title,
        dealId,
        dealTitle: String(r.TITLE ?? r.title ?? ""),
        stageId,
        stageTitleCrm,
        stageSemanticId,
        categoryId,
        opportunity,
        currencyId,
        clientName: extractClientName(r),
        assignedById: r.ASSIGNED_BY_ID
          ? String(r.ASSIGNED_BY_ID)
          : r.assignedById
            ? String(r.assignedById)
            : undefined,
        linkFieldCode: linkField,
        linkFieldValue: extractLinkFieldValue(r, linkField),
        candidate,
        exact,
      });
    });
  });
  return out;
}

function LoadedDealStagesPanel({
  aggregates,
  targets,
  crmStageTitles,
}: {
  aggregates: { data?: ExpoAggregate; isLoading?: boolean; isError?: boolean }[];
  targets: ExpoItem[];
  crmStageTitles: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);

  const rows = useMemo(
    () => collectLoadedDealRows(aggregates, targets, crmStageTitles),
    [aggregates, targets, crmStageTitles],
  );

  const loading = aggregates.filter((q) => q.isLoading).length;
  const errored = aggregates.filter((q) => q.isError).length;
  const enrichedExpos = aggregates.filter((q) => isFoundAggregate(q.data)).length;

  const stageSummary = useMemo(() => {
    type Entry = {
      stageId: string;
      count: number;
      stageTitle?: string;
      semanticIds: Set<string>;
      categoryIds: Set<string>;
      examples: LoadedDealRow[];
    };
    const map = new Map<string, Entry>();
    rows.forEach((row) => {
      const key = row.stageId || "—";
      const entry =
        map.get(key) ??
        ({
          stageId: row.stageId,
          count: 0,
          stageTitle: row.stageTitleCrm,
          semanticIds: new Set<string>(),
          categoryIds: new Set<string>(),
          examples: [],
        } satisfies Entry);
      entry.count += 1;
      if (!entry.stageTitle && row.stageTitleCrm) entry.stageTitle = row.stageTitleCrm;
      if (row.stageSemanticId) entry.semanticIds.add(row.stageSemanticId);
      if (row.categoryId) entry.categoryIds.add(row.categoryId);
      if (entry.examples.length < 5) entry.examples.push(row);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  const highlight = (row: LoadedDealRow): { cls: string; label: string } | undefined => {
    const key = row.exact ?? row.candidate;
    if (!key) return undefined;
    return { cls: STAGE_HIGHLIGHT[key].cls, label: STAGE_HIGHLIGHT[key].label };
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border bg-muted/30 p-2 text-left"
          data-testid="gantt-diag-loaded-deals-toggle"
        >
          <span>
            Стадии загруженных сделок · уникальных STAGE_ID:{" "}
            <b>{stageSummary.length}</b> · всего сделок: <b>{rows.length}</b> ·
            выставок с данными: <b>{enrichedExpos}</b>/<b>{targets.length}</b>
            {loading > 0 ? (
              <>
                {" "}· загружается: <b>{loading}</b>
              </>
            ) : null}
            {errored > 0 ? (
              <>
                {" "}· ошибок: <b className="text-red-600">{errored}</b>
              </>
            ) : null}
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <div className="text-muted-foreground">
          Раздел показывает STAGE_ID, реально встреченные в сделках, подтянутых
          за текущий месяц (через <code>crm.deal.list</code> по полю
          <code className="ml-1">{dealExpoFieldCode ?? "—"}</code>). Используйте
          эти ID, чтобы закрепить значения в{" "}
          <code>dealStageIds</code> (client/src/lib/config.ts), если общий
          справочник стадий недоступен.
        </div>

        {rows.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-muted-foreground">
            В выбранном месяце не загружено ни одной сделки — нечего показать.
            Проверьте поле связи сделки с выставкой и фильтры выставок.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table
                className="w-full text-[11px]"
                data-testid="gantt-diag-loaded-stage-summary"
              >
                <thead>
                  <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1">STAGE_ID</th>
                    <th className="px-2 py-1">Название (CRM)</th>
                    <th className="px-2 py-1">Semantic</th>
                    <th className="px-2 py-1">Category</th>
                    <th className="px-2 py-1">Сделок</th>
                    <th className="px-2 py-1">Совпадение</th>
                    <th className="px-2 py-1">Примеры (ID · title · клиент · сумма · выставка)</th>
                  </tr>
                </thead>
                <tbody>
                  {stageSummary.map((entry) => {
                    const exampleMatch = entry.examples.find((e) => e.exact ?? e.candidate);
                    const key = exampleMatch?.exact ?? exampleMatch?.candidate;
                    const hl = key ? STAGE_HIGHLIGHT[key] : undefined;
                    return (
                      <tr
                        key={entry.stageId || "blank"}
                        className={`border-b align-top ${hl ? hl.cls : ""}`}
                        data-testid={`gantt-diag-loaded-stage-${entry.stageId || "blank"}`}
                      >
                        <td className="px-2 py-1 font-mono">{entry.stageId || "—"}</td>
                        <td className="px-2 py-1">{entry.stageTitle || "—"}</td>
                        <td className="px-2 py-1 font-mono">
                          {Array.from(entry.semanticIds).join(", ") || "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {Array.from(entry.categoryIds).join(", ") || "—"}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{entry.count}</td>
                        <td className="px-2 py-1">
                          {exampleMatch?.exact ? (
                            <span>
                              <b>точное</b> → {STAGE_HIGHLIGHT[exampleMatch.exact].label}
                            </span>
                          ) : exampleMatch?.candidate ? (
                            <span>
                              кандидат →{" "}
                              {STAGE_HIGHLIGHT[exampleMatch.candidate].label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <ul className="space-y-0.5">
                            {entry.examples.map((ex) => (
                              <li key={ex.dealId} className="break-all">
                                <code>#{ex.dealId}</code>
                                {ex.dealTitle ? ` · ${ex.dealTitle}` : ""}
                                {ex.clientName ? ` · ${ex.clientName}` : ""}
                                {ex.opportunity
                                  ? ` · ${ex.opportunity}${ex.currencyId ? " " + ex.currencyId : ""}`
                                  : ""}
                                {" · "}
                                <span className="text-muted-foreground">
                                  {ex.expoTitle} (#{ex.expoId})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <table
                className="w-full text-[11px]"
                data-testid="gantt-diag-loaded-deals-table"
              >
                <thead>
                  <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1">Deal ID</th>
                    <th className="px-2 py-1">Title</th>
                    <th className="px-2 py-1">Клиент</th>
                    <th className="px-2 py-1">STAGE_ID</th>
                    <th className="px-2 py-1">Stage title</th>
                    <th className="px-2 py-1">Opportunity</th>
                    <th className="px-2 py-1">Assigned</th>
                    <th className="px-2 py-1">Выставка</th>
                    <th className="px-2 py-1">
                      Link value (<code>{dealExpoFieldCode ?? "—"}</code>)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const hl = highlight(row);
                    return (
                      <tr
                        key={`${row.expoId}-${row.dealId}`}
                        className={`border-b align-top ${hl ? hl.cls : ""}`}
                        data-testid={`gantt-diag-loaded-deal-row-${row.dealId}`}
                      >
                        <td className="px-2 py-1 font-mono">#{row.dealId}</td>
                        <td className="px-2 py-1">{row.dealTitle || "—"}</td>
                        <td className="px-2 py-1">{row.clientName || "—"}</td>
                        <td className="px-2 py-1 font-mono">{row.stageId || "—"}</td>
                        <td className="px-2 py-1">{row.stageTitleCrm || "—"}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {row.opportunity
                            ? `${row.opportunity}${row.currencyId ? " " + row.currencyId : ""}`
                            : "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {row.assignedById ?? "—"}
                        </td>
                        <td className="px-2 py-1">
                          {row.expoTitle} <span className="text-muted-foreground">(#{row.expoId})</span>
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {row.linkFieldValue ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

type StageFinderDealRow = {
  dealId: string;
  dealTitle: string;
  stageId: string;
  stageSemanticId?: string;
  categoryId?: string;
  opportunity?: string;
  currencyId?: string;
  clientName?: string;
  assignedById?: string;
  linkFieldValue?: string;
  stageTitleCrm?: string;
  candidate?: DealStatusKey;
  exact?: DealStatusKey;
};

type StageFinderGroup = {
  stageId: string;
  stageTitle?: string;
  count: number;
  semanticIds: Set<string>;
  categoryIds: Set<string>;
  examples: StageFinderDealRow[];
};

function readString(item: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = item[key];
    if (v !== undefined && v !== null && v !== "") {
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
  }
  return undefined;
}

function toStageFinderRow(
  deal: CrmItem,
  crmStageTitles: Map<string, string>,
): StageFinderDealRow {
  const r = deal as Record<string, unknown>;
  const dealId = readString(r, "ID", "id") ?? "";
  const stageId = readString(r, "STAGE_ID", "stageId") ?? "";
  const stageTitleCrm = stageId ? crmStageTitles.get(stageId) : undefined;
  const exact = matchDealStatus(stageId, stageTitleCrm);
  const candidate = exact ?? candidateDealStatusByName(stageTitleCrm);
  return {
    dealId,
    dealTitle: readString(r, "TITLE", "title") ?? "",
    stageId,
    stageTitleCrm,
    stageSemanticId: readString(r, "STAGE_SEMANTIC_ID", "stageSemanticId"),
    categoryId: readString(r, "CATEGORY_ID", "categoryId"),
    opportunity: readString(r, "OPPORTUNITY", "opportunity"),
    currencyId: readString(r, "CURRENCY_ID", "currencyId"),
    clientName:
      readString(r, "COMPANY_TITLE", "companyTitle") ??
      readString(r, "CONTACT_NAME", "contactName"),
    assignedById: readString(r, "ASSIGNED_BY_ID", "assignedById"),
    linkFieldValue: readString(
      r,
      "UF_CRM_6989BC521C964",
      "ufCrm_6989BC521C964",
      "ufCrm6989Bc521C964",
    ),
    candidate,
    exact,
  };
}

function StageIdFinderPanel({
  crmStageTitles,
}: {
  crmStageTitles: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [limitInput, setLimitInput] = useState("300");
  const [categoryInput, setCategoryInput] = useState("");
  const [filter, setFilter] = useState("");
  const [runToken, setRunToken] = useState(0);
  const [lookupId, setLookupId] = useState("");
  const [lookupToken, setLookupToken] = useState(0);

  const enabled = isInsideBitrix();

  const parsedLimit = useMemo(() => {
    const n = Math.floor(Number(limitInput));
    if (!Number.isFinite(n) || n <= 0) return 300;
    return Math.min(500, Math.max(1, n));
  }, [limitInput]);

  const normalizedCategory = categoryInput.trim();

  const probeQuery = useQuery<DealStageProbeResult>({
    queryKey: ["stage-finder-deal-probe", runToken, parsedLimit, normalizedCategory],
    queryFn: () =>
      fetchDealsForStageProbe({
        limit: parsedLimit,
        categoryId: normalizedCategory === "" ? undefined : normalizedCategory,
      }),
    enabled: enabled && runToken > 0,
    staleTime: 60_000,
  });

  const lookupQuery = useQuery<DealProbeLookup>({
    queryKey: ["stage-finder-deal-lookup", lookupToken, lookupId.trim()],
    queryFn: () => probeDealById(lookupId.trim()),
    enabled: enabled && lookupToken > 0 && lookupId.trim() !== "",
    staleTime: 60_000,
  });

  const rows = useMemo<StageFinderDealRow[]>(() => {
    const deals = probeQuery.data?.deals ?? [];
    return deals.map((deal) => toStageFinderRow(deal, crmStageTitles));
  }, [probeQuery.data, crmStageTitles]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return rows;
    return rows.filter((row) => {
      const bits = [
        row.dealId,
        row.dealTitle,
        row.clientName ?? "",
        row.stageId,
        row.stageTitleCrm ?? "",
        row.stageSemanticId ?? "",
        row.categoryId ?? "",
        row.assignedById ?? "",
        row.linkFieldValue ?? "",
      ];
      return bits.some((bit) => bit.toLocaleLowerCase("ru-RU").includes(needle));
    });
  }, [rows, filter]);

  const grouped = useMemo<StageFinderGroup[]>(() => {
    const map = new Map<string, StageFinderGroup>();
    filtered.forEach((row) => {
      const key = row.stageId || "—";
      const entry: StageFinderGroup = map.get(key) ?? {
        stageId: row.stageId,
        stageTitle: row.stageTitleCrm,
        count: 0,
        semanticIds: new Set<string>(),
        categoryIds: new Set<string>(),
        examples: [],
      };
      entry.count += 1;
      if (!entry.stageTitle && row.stageTitleCrm) entry.stageTitle = row.stageTitleCrm;
      if (row.stageSemanticId) entry.semanticIds.add(row.stageSemanticId);
      if (row.categoryId) entry.categoryIds.add(row.categoryId);
      if (entry.examples.length < 5) entry.examples.push(row);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const lookupRow = useMemo<StageFinderDealRow | undefined>(() => {
    if (lookupQuery.data?.status !== "found") return undefined;
    return toStageFinderRow(lookupQuery.data.deal, crmStageTitles);
  }, [lookupQuery.data, crmStageTitles]);

  const rowHighlightClass = (row: StageFinderDealRow) => {
    const key = row.exact ?? row.candidate;
    return key ? STAGE_HIGHLIGHT[key].cls : "";
  };

  const hasProbed = probeQuery.fetchStatus !== "idle" || probeQuery.isFetched;
  const probeError = probeQuery.data?.error ?? (probeQuery.error as Error | undefined)?.message;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border bg-muted/30 p-2 text-left"
          data-testid="gantt-diag-stage-finder-toggle"
        >
          <span>
            Поиск stageId по сделкам
            {rows.length > 0 ? (
              <>
                {" "}· загружено сделок: <b>{rows.length}</b> · уникальных STAGE_ID:{" "}
                <b>{grouped.length}</b>
              </>
            ) : (
              <> (раскройте для ручного запуска)</>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <div className="text-muted-foreground">
          Прямое чтение реальных сделок через <code>crm.deal.list</code> с бережным
          ограничением числа строк — на случай, когда справочник стадий недоступен.
          Запрос выполняется только по нажатию «Запросить»: выберите лимит, при
          необходимости укажите CATEGORY_ID (воронку), затем используйте фильтр,
          чтобы найти сделки по названию, клиенту или STAGE_ID. Точное совпадение
          по названию стадии подсвечивается — сравните с «Подписываем договор»,
          «Строим» и «Проект завершён» и зафиксируйте STAGE_ID в{" "}
          <code>dealStageIds</code> (client/src/lib/config.ts).
        </div>

        <div className="grid gap-2 md:grid-cols-[auto_auto_auto_1fr]">
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Лимит</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className="h-8 w-[90px] text-xs"
              data-testid="gantt-diag-stage-finder-limit"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">CATEGORY_ID</span>
            <Input
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder="любая"
              className="h-8 w-[120px] text-xs"
              data-testid="gantt-diag-stage-finder-category"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRunToken((n) => n + 1)}
            disabled={!enabled || probeQuery.isFetching}
            data-testid="gantt-diag-stage-finder-run"
          >
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${probeQuery.isFetching ? "animate-spin" : ""}`}
            />
            {runToken === 0 ? "Запросить сделки" : "Перезапросить"}
          </Button>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Фильтр по названию / клиенту / STAGE_ID / ID"
            className="h-8 text-xs"
            data-testid="gantt-diag-stage-finder-filter"
          />
        </div>

        {!enabled && (
          <div className="rounded border border-dashed p-2 text-muted-foreground">
            Вне Bitrix24 — запросы CRM отключены.
          </div>
        )}

        {probeQuery.isFetching && (
          <div className="text-muted-foreground">Загружаю сделки…</div>
        )}

        {hasProbed && probeError && (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            Ошибка <code>crm.deal.list</code>: {probeError}
          </div>
        )}

        {probeQuery.data && !probeError && (
          <div className="text-muted-foreground">
            Всего получено: <b>{probeQuery.data.deals.length}</b> (лимит{" "}
            <b>{probeQuery.data.requestedLimit}</b>
            {probeQuery.data.categoryId !== undefined &&
            probeQuery.data.categoryId !== ""
              ? <> · категория <code>{String(probeQuery.data.categoryId)}</code></>
              : <> · все категории</>}
            {probeQuery.data.truncated ? " · достигнут лимит" : ""}) · показано
            после фильтра: <b>{filtered.length}</b>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table
                className="w-full text-[11px]"
                data-testid="gantt-diag-stage-finder-summary"
              >
                <thead>
                  <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1">STAGE_ID</th>
                    <th className="px-2 py-1">Название (CRM, если есть)</th>
                    <th className="px-2 py-1">Semantic</th>
                    <th className="px-2 py-1">Category</th>
                    <th className="px-2 py-1">Сделок</th>
                    <th className="px-2 py-1">Совпадение</th>
                    <th className="px-2 py-1">Примеры (ID · title · клиент)</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((entry) => {
                    const example = entry.examples.find((e) => e.exact ?? e.candidate);
                    const key = example?.exact ?? example?.candidate;
                    const hl = key ? STAGE_HIGHLIGHT[key] : undefined;
                    return (
                      <tr
                        key={entry.stageId || "blank"}
                        className={`border-b align-top ${hl ? hl.cls : ""}`}
                        data-testid={`gantt-diag-stage-finder-group-${entry.stageId || "blank"}`}
                      >
                        <td className="px-2 py-1 font-mono">{entry.stageId || "—"}</td>
                        <td className="px-2 py-1">{entry.stageTitle || "—"}</td>
                        <td className="px-2 py-1 font-mono">
                          {Array.from(entry.semanticIds).join(", ") || "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {Array.from(entry.categoryIds).join(", ") || "—"}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{entry.count}</td>
                        <td className="px-2 py-1">
                          {example?.exact ? (
                            <span>
                              <b>точное</b> → {STAGE_HIGHLIGHT[example.exact].label}
                            </span>
                          ) : example?.candidate ? (
                            <span>
                              кандидат →{" "}
                              {STAGE_HIGHLIGHT[example.candidate].label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <ul className="space-y-0.5">
                            {entry.examples.map((ex) => (
                              <li key={ex.dealId} className="break-all">
                                <code>#{ex.dealId}</code>
                                {ex.dealTitle ? ` · ${ex.dealTitle}` : ""}
                                {ex.clientName ? ` · ${ex.clientName}` : ""}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <table
                className="w-full text-[11px]"
                data-testid="gantt-diag-stage-finder-rows"
              >
                <thead>
                  <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1">Deal ID</th>
                    <th className="px-2 py-1">Title</th>
                    <th className="px-2 py-1">Клиент</th>
                    <th className="px-2 py-1">STAGE_ID</th>
                    <th className="px-2 py-1">Semantic</th>
                    <th className="px-2 py-1">Cat</th>
                    <th className="px-2 py-1">Opportunity</th>
                    <th className="px-2 py-1">Assigned</th>
                    <th className="px-2 py-1">UF выставка</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.dealId}
                      className={`border-b align-top ${rowHighlightClass(row)}`}
                      data-testid={`gantt-diag-stage-finder-row-${row.dealId}`}
                    >
                      <td className="px-2 py-1 font-mono">#{row.dealId}</td>
                      <td className="px-2 py-1">{row.dealTitle || "—"}</td>
                      <td className="px-2 py-1">{row.clientName || "—"}</td>
                      <td className="px-2 py-1 font-mono">{row.stageId || "—"}</td>
                      <td className="px-2 py-1 font-mono">
                        {row.stageSemanticId || "—"}
                      </td>
                      <td className="px-2 py-1 font-mono">{row.categoryId || "—"}</td>
                      <td className="px-2 py-1 tabular-nums">
                        {row.opportunity
                          ? `${row.opportunity}${row.currencyId ? " " + row.currencyId : ""}`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 font-mono">{row.assignedById ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">
                        {row.linkFieldValue ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-1 font-medium">Точечный просмотр сделки по ID</div>
          <div className="mb-2 text-muted-foreground">
            Введите ID сделки (например, <code>3108</code>) и нажмите «Открыть».
            Приложение вызовет <code>crm.deal.get</code> и покажет сырые
            <code className="mx-1">STAGE_ID</code>, <code>STAGE_SEMANTIC_ID</code>,
            <code className="mx-1">CATEGORY_ID</code>, <code>UF_CRM_6989BC521C964</code>.
            Ничего не сохраняется и не изменяется.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder="ID сделки"
              className="h-8 w-[140px] text-xs"
              data-testid="gantt-diag-stage-finder-lookup-id"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLookupToken((n) => n + 1)}
              disabled={!enabled || !lookupId.trim() || lookupQuery.isFetching}
              data-testid="gantt-diag-stage-finder-lookup-run"
            >
              <RefreshCw
                className={`mr-2 h-3.5 w-3.5 ${lookupQuery.isFetching ? "animate-spin" : ""}`}
              />
              Открыть
            </Button>
          </div>
          {lookupQuery.isFetching && (
            <div className="mt-2 text-muted-foreground">Загружаю сделку…</div>
          )}
          {lookupQuery.data?.status === "failed" && (
            <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
              Ошибка: {lookupQuery.data.error}
            </div>
          )}
          {lookupQuery.data?.status === "not-found" && (
            <div className="mt-2 text-muted-foreground">
              Сделка не найдена или пустой ответ.
            </div>
          )}
          {lookupRow && (
            <div className="mt-2 space-y-1 text-[11px]">
              <div>
                <b>#{lookupRow.dealId}</b>
                {lookupRow.dealTitle ? ` · ${lookupRow.dealTitle}` : ""}
                {lookupRow.clientName ? ` · ${lookupRow.clientName}` : ""}
              </div>
              <div>
                STAGE_ID: <code>{lookupRow.stageId || "—"}</code> · semantic:{" "}
                <code>{lookupRow.stageSemanticId || "—"}</code> · category:{" "}
                <code>{lookupRow.categoryId || "—"}</code>
              </div>
              <div>
                Stage title (из CRM): {lookupRow.stageTitleCrm || "—"} · совпадение:{" "}
                {lookupRow.exact ? (
                  <>
                    <b>точное</b> → {STAGE_HIGHLIGHT[lookupRow.exact].label}
                  </>
                ) : lookupRow.candidate ? (
                  <>
                    кандидат → {STAGE_HIGHLIGHT[lookupRow.candidate].label}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div>
                Opportunity:{" "}
                {lookupRow.opportunity
                  ? `${lookupRow.opportunity}${lookupRow.currencyId ? " " + lookupRow.currencyId : ""}`
                  : "—"}{" "}
                · Assigned: <code>{lookupRow.assignedById ?? "—"}</code> · UF
                выставка: <code>{lookupRow.linkFieldValue ?? "—"}</code>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StageFetchDiagnostics({
  diagnostics,
  totalStages,
}: {
  diagnostics: import("@/lib/expo-data").DealStagesDiagnostics;
  totalStages: number;
}) {
  const [open, setOpen] = useState(true);
  const failedAttempts = diagnostics.attempts.filter((a) => !a.ok);
  const successfulAttempts = diagnostics.attempts.filter((a) => a.ok && a.count > 0);
  const bySourceEntries = Object.entries(diagnostics.bySource).sort(([a], [b]) => a.localeCompare(b));
  const byEntityEntries = Object.entries(diagnostics.byEntityId).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border bg-muted/30 p-2 text-left"
          data-testid="gantt-diag-stage-fetch-toggle"
        >
          <span>
            Диагностика загрузки стадий · всего получено: <b>{totalStages}</b> · успешных
            источников: <b>{successfulAttempts.length}</b> · ошибок:{" "}
            <b>{failedAttempts.length}</b>
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        <div className="text-muted-foreground">
          Category IDs обнаружено:{" "}
          <code>{diagnostics.categoryIds.join(", ") || "—"}</code>
        </div>

        {bySourceEntries.length > 0 && (
          <div>
            <div className="font-medium">Счётчики по источникам</div>
            <ul className="ml-4 list-disc">
              {bySourceEntries.map(([src, count]) => (
                <li key={src}>
                  <code>{src}</code>: <b>{count}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {byEntityEntries.length > 0 && (
          <div>
            <div className="font-medium">Счётчики по entityId</div>
            <ul className="ml-4 list-disc">
              {byEntityEntries.map(([entityId, count]) => (
                <li key={entityId}>
                  <code>{entityId}</code>: <b>{count}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {failedAttempts.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-medium">Ошибки запросов ({failedAttempts.length})</div>
            <ul className="ml-4 list-disc" data-testid="gantt-diag-stage-fetch-errors">
              {failedAttempts.map((a, idx) => (
                <li key={idx}>
                  <code>{a.source}</code>
                  {a.entityId ? (
                    <>
                      [<code>{a.entityId}</code>]
                    </>
                  ) : null}
                  : {a.error ?? "неизвестная ошибка"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

type StageRowView = StatusRef & {
  normalized: string;
  exact?: DealStatusKey;
  candidate?: DealStatusKey;
};

const STAGE_HIGHLIGHT: Record<DealStatusKey, { label: string; cls: string }> = {
  signingContract: {
    label: "Подписываем договор",
    cls: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100",
  },
  building: {
    label: "Строим",
    cls: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  },
  projectCompleted: {
    label: "Проект завершён",
    cls: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
  },
};

function AllDealStagesTable({ stages }: { stages: StatusRef[] }) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(false);

  const rows = useMemo<StageRowView[]>(() => {
    return stages.map((s) => {
      const normalized = normalizeStageText(s.title ?? "");
      const exact = matchDealStatusByName(s.title);
      const candidate = exact ?? candidateDealStatusByName(s.title);
      return { ...s, normalized, exact, candidate };
    });
  }, [stages]);

  const filtered = useMemo(() => {
    const needle = normalizeStageText(filter);
    return rows.filter((row) => {
      if (onlyCandidates && !row.candidate) return false;
      if (!needle) return true;
      return (
        row.normalized.includes(needle) ||
        row.id.toLocaleLowerCase().includes(filter.toLocaleLowerCase()) ||
        (row.entityId ?? "").toLocaleLowerCase().includes(filter.toLocaleLowerCase())
      );
    });
  }, [rows, filter, onlyCandidates]);

  const grouped = useMemo(() => {
    const out = new Map<string, StageRowView[]>();
    filtered.forEach((row) => {
      const key = row.entityId ?? row.categoryId ?? "—";
      const list = out.get(key) ?? [];
      list.push(row);
      out.set(key, list);
    });
    return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const totalCandidates = rows.filter((r) => r.candidate).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border bg-muted/30 p-2 text-left"
          data-testid="gantt-diag-stages-toggle"
        >
          <span>
            Все стадии сделок (<b>{rows.length}</b>) · совпадений по подсказкам:{" "}
            <b>{totalCandidates}</b>
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Фильтр по ID / названию / entityId"
            className="h-8 max-w-xs text-xs"
            data-testid="gantt-diag-stages-filter"
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyCandidates}
              onChange={(e) => setOnlyCandidates(e.target.checked)}
              data-testid="gantt-diag-stages-only-candidates"
            />
            Только кандидаты (подпис/стро/заверш/договор/проект)
          </label>
          <span className="text-xs text-muted-foreground">
            Показано: <b>{filtered.length}</b> из <b>{rows.length}</b>
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-muted-foreground">
            Список стадий пуст. Проверьте доступ к crm.dealcategory.list /
            crm.status.list.
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([entityId, items]) => (
              <div key={entityId} className="rounded-md border">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2 py-1">
                  <div className="font-medium">
                    entityId: <code>{entityId}</code>
                  </div>
                  <div className="text-muted-foreground">
                    stages: <b>{items.length}</b>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]" data-testid={`gantt-diag-stages-table-${entityId}`}>
                    <thead>
                      <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-1">STATUS_ID</th>
                        <th className="px-2 py-1">Название</th>
                        <th className="px-2 py-1">Normalized</th>
                        <th className="px-2 py-1">Category</th>
                        <th className="px-2 py-1">Sort</th>
                        <th className="px-2 py-1">Source</th>
                        <th className="px-2 py-1">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((row) => {
                        const highlight = row.exact
                          ? STAGE_HIGHLIGHT[row.exact]
                          : row.candidate
                            ? STAGE_HIGHLIGHT[row.candidate]
                            : undefined;
                        return (
                          <tr
                            key={`${row.entityId ?? ""}:${row.id}`}
                            className={`border-b align-top ${highlight ? highlight.cls : ""}`}
                            data-testid={`gantt-diag-stage-row-${row.id}`}
                          >
                            <td className="px-2 py-1 font-mono">{row.id}</td>
                            <td className="px-2 py-1">{row.title || "—"}</td>
                            <td className="px-2 py-1 font-mono text-muted-foreground">
                              {row.normalized || "—"}
                            </td>
                            <td className="px-2 py-1 font-mono">{row.categoryId ?? "—"}</td>
                            <td className="px-2 py-1 font-mono">{row.sort ?? "—"}</td>
                            <td className="px-2 py-1 font-mono text-muted-foreground">
                              {row.source ?? "—"}
                            </td>
                            <td className="px-2 py-1">
                              {row.exact ? (
                                <span>
                                  <b>точное</b> → {STAGE_HIGHLIGHT[row.exact].label}
                                </span>
                              ) : row.candidate ? (
                                <span>
                                  кандидат → {STAGE_HIGHLIGHT[row.candidate].label}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="text-muted-foreground">
          Подсветка: жёлтая — похоже на «Подписываем договор», синяя — «Строим»,
          зелёная — «Проект завершён». Точное совпадение помечено «точное»;
          частичное — «кандидат». Скопируйте нужный <code>STATUS_ID</code> и
          закрепите его в <code>dealStageIds</code> (client/src/lib/config.ts).
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ListView({ expos }: { expos: ExpoItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3">Название</th>
            <th className="py-2 pr-3">Даты проведения</th>
            <th className="py-2 pr-3">Монтаж</th>
            <th className="py-2 pr-3">Демонтаж</th>
            <th className="py-2 pr-3">Лиды</th>
            <th className="py-2 pr-3">Сделки</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {expos.map((expo) => (
            <tr key={expo.id} className="border-b hover:bg-accent/40" data-testid={`list-row-${expo.id}`}>
              <td className="py-2 pr-3 font-medium">{expo.title}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatDateRange(expo.expoStart, expo.expoEnd)}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatDateRange(expo.installStart, expo.installEnd)}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatDateRange(expo.dismantleStart, expo.dismantleEnd)}</td>
              <td className="py-2 pr-3"><StatsCount expoId={expo.id} kind="lead" /></td>
              <td className="py-2 pr-3"><StatsCount expoId={expo.id} kind="deal" /></td>
              <td className="py-2 pr-3 text-right">
                <Link href={`/event/${expo.id}`}>
                  <a className="text-sm font-medium text-primary hover:underline" data-testid={`link-open-${expo.id}`}>Открыть</a>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsMini({ expoId }: { expoId: number }) {
  const agg = useQuery({
    queryKey: ["expo-aggregate", expoId],
    queryFn: () => buildExpoAggregate(expoId),
    enabled: isInsideBitrix(),
  });
  const data = isFoundAggregate(agg.data) ? agg.data : undefined;
  if (!data) return null;
  return (
    <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
      <span>Лиды: <b className="text-foreground">{data.leadStats.total}</b></span>
      <span>Сделки: <b className="text-foreground">{data.dealStats.total}</b></span>
      <span className="text-emerald-600">Выигр.: {data.dealStats.won}</span>
    </div>
  );
}

function StatsCount({ expoId, kind }: { expoId: number; kind: "lead" | "deal" }) {
  const agg = useQuery<ExpoAggregate>({
    queryKey: ["expo-aggregate", expoId],
    queryFn: () => buildExpoAggregate(expoId),
    enabled: isInsideBitrix(),
  });
  const data = isFoundAggregate(agg.data) ? agg.data : undefined;
  if (!data) return <span className="text-muted-foreground">…</span>;
  const stats = kind === "lead" ? data.leadStats : data.dealStats;
  return <span className="font-medium">{stats.total}</span>;
}

function navigateToEvent(id: number | string) {
  window.location.hash = `/event/${id}`;
}
