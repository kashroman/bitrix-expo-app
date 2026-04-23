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
  fetchExpoList,
  fetchDealStages,
  fetchDealStagesDetailed,
  isFoundAggregate,
  statusTitleMap,
} from "@/lib/expo-data";
import type { DealStagesResult, StatusRef } from "@/lib/expo-data";
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

        <AllDealStagesTable stages={stages} />
      </CardContent>
    </Card>
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
