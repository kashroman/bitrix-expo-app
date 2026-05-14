import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpoItem, BuildScheduleDeal } from "@/lib/expo-data";
import { parseDate } from "@/lib/format";
import {
  DEAL_STATUS_COLORS,
  DEAL_STATUS_LABELS,
  DEAL_STATUS_ORDER,
  DealStatusKey,
  PHASE_FILLS,
} from "@/lib/config";

const LEFT_COL_PX = 240;
const DAY_HEIGHT_BASE = 56;
const DEAL_BAR_HEIGHT = 18;
const DEAL_BAR_GAP = 3;
const DEAL_STACK_PAD_Y = 6;
const NEUTRAL_BAR_COLOR = "#94a3b8";

const MONTH_NAMES_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

type Phase = { key: "mount" | "expo" | "dismantle"; start: Date; end: Date };

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function monthStartOf(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function monthEndOf(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

function daysInMonth(year: number, month: number): number {
  return monthEndOf(year, month).getDate();
}

function phasesOf(expo: ExpoItem): Phase[] {
  const expoStart = parseDate(expo.expoStart);
  const expoEnd = parseDate(expo.expoEnd);
  const result: Phase[] = [];
  const mountStart = parseDate(expo.installStart);
  const mountEnd = parseDate(expo.installEnd) ?? expoStart;
  if (mountStart && mountEnd)
    result.push({ key: "mount", start: mountStart, end: mountEnd });
  if (expoStart && expoEnd)
    result.push({ key: "expo", start: expoStart, end: expoEnd });
  const dismantleStart = parseDate(expo.dismantleStart) ?? expoEnd;
  const dismantleEnd = parseDate(expo.dismantleEnd) ?? dismantleStart;
  if (dismantleStart && dismantleEnd)
    result.push({ key: "dismantle", start: dismantleStart, end: dismantleEnd });
  return result;
}

// Clip a [start, end] day range to the 1..N day index of the selected month.
export function clipToMonth(
  range: { start: Date; end: Date },
  year: number,
  month: number,
): { startDay: number; endDay: number } | undefined {
  const monthStart = stripTime(monthStartOf(year, month)).getTime();
  const monthEnd = stripTime(monthEndOf(year, month)).getTime();
  const s = stripTime(range.start).getTime();
  const e = stripTime(range.end).getTime();
  if (e < monthStart || s > monthEnd) return undefined;
  const clippedStart = Math.max(s, monthStart);
  const clippedEnd = Math.min(e, monthEnd);
  const startDay = new Date(clippedStart).getDate();
  const endDay = new Date(clippedEnd).getDate();
  return { startDay, endDay };
}

function dealColor(deal: BuildScheduleDeal): string {
  if (deal.status && (DEAL_STATUS_COLORS[deal.status] as string)) {
    return DEAL_STATUS_COLORS[deal.status];
  }
  return NEUTRAL_BAR_COLOR;
}

function dealStageLabel(deal: BuildScheduleDeal): string {
  if (deal.status) return DEAL_STATUS_LABELS[deal.status];
  return deal.stageTail || deal.stageId || "—";
}

function dealSummaryLine(deal: BuildScheduleDeal): string {
  const parts: string[] = [];
  if (deal.clientName) parts.push(deal.clientName);
  else parts.push(deal.title);
  if (deal.manager) parts.push(deal.manager);
  if (deal.budget) parts.push(deal.budget);
  parts.push(dealStageLabel(deal));
  return parts.join(" · ");
}

// Span the deal across the exhibition's full mount→dismantle interval. This
// matches the user-approved mockup where a deal bar covers the whole row of
// its expo (clipped to the visible month).
function expoOverallRange(expo: ExpoItem): { start: Date; end: Date } | undefined {
  const starts = [parseDate(expo.installStart), parseDate(expo.expoStart)].filter(
    Boolean,
  ) as Date[];
  const ends = [
    parseDate(expo.dismantleEnd),
    parseDate(expo.expoEnd),
    parseDate(expo.installEnd),
  ].filter(Boolean) as Date[];
  if (!starts.length && !ends.length) return undefined;
  const start = starts.length
    ? new Date(Math.min(...starts.map((d) => d.getTime())))
    : ends[0];
  const end = ends.length
    ? new Date(Math.max(...ends.map((d) => d.getTime())))
    : start;
  return { start: stripTime(start!), end: stripTime(end!) };
}

function compareExpos(a: ExpoItem, b: ExpoItem): number {
  const sa = parseDate(a.expoStart)?.getTime() ?? Number.POSITIVE_INFINITY;
  const sb = parseDate(b.expoStart)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return a.title.localeCompare(b.title, "ru-RU");
}

export function BuildScheduleView({
  expos,
  dealsByExpoId,
  initialMonth,
  onMonthChange,
  onSelectExpo,
  onSelectDeal,
  emptyMessage,
}: {
  expos: ExpoItem[];
  dealsByExpoId: Map<number, BuildScheduleDeal[]> | undefined;
  initialMonth?: Date;
  onMonthChange?: (monthStart: Date) => void;
  onSelectExpo: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
  emptyMessage?: string;
  /** @deprecated kept for backwards compatibility with old call sites */
  isFetching?: boolean;
  /** @deprecated kept for backwards compatibility — month is the authoritative scope now */
  initialYear?: number;
  /** @deprecated */
  onYearChange?: (y: number) => void;
}) {
  const [cursor, setCursor] = useState<Date>(() => {
    if (initialMonth)
      return monthStartOf(initialMonth.getFullYear(), initialMonth.getMonth());
    const now = new Date();
    return monthStartOf(now.getFullYear(), now.getMonth());
  });

  const initialY = initialMonth?.getFullYear();
  const initialM = initialMonth?.getMonth();
  useEffect(() => {
    if (initialY === undefined || initialM === undefined) return;
    setCursor((prev) => {
      if (prev.getFullYear() === initialY && prev.getMonth() === initialM)
        return prev;
      return monthStartOf(initialY, initialM);
    });
  }, [initialY, initialM]);

  useEffect(() => {
    onMonthChange?.(cursor);
  }, [cursor, onMonthChange]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const totalDays = daysInMonth(year, month);

  const sortedExpos = useMemo(
    () => [...expos].sort(compareExpos),
    [expos],
  );

  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 2; y <= currentYear + 3; y++) set.add(y);
    expos.forEach((expo) => {
      const s = parseDate(expo.expoStart);
      const e = parseDate(expo.expoEnd);
      if (s) set.add(s.getFullYear());
      if (e) set.add(e.getFullYear());
    });
    set.add(year);
    return Array.from(set).sort((a, b) => a - b);
  }, [expos, year]);

  const goPrev = () => setCursor(monthStartOf(year, month - 1));
  const goNext = () => setCursor(monthStartOf(year, month + 1));
  const goToday = () => {
    const now = new Date();
    setCursor(monthStartOf(now.getFullYear(), now.getMonth()));
  };

  const today = stripTime(new Date());
  const todayIndex =
    today.getFullYear() === year && today.getMonth() === month
      ? today.getDate()
      : -1;

  const isEmpty = sortedExpos.length === 0;
  const emptyText =
    emptyMessage ??
    "Нет выставок со сделками на стадиях графика застройки в этом месяце.";

  return (
    <div>
      <MonthControls
        cursor={cursor}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onSelect={(d) => setCursor(d)}
        yearOptions={yearOptions}
      />

      <div className="mt-3 overflow-hidden rounded-md border bg-background">
        <div
          className="grid min-w-0 items-stretch border-b bg-background/95 text-xs"
          style={{
            gridTemplateColumns: `${LEFT_COL_PX}px repeat(${totalDays}, minmax(0, 1fr))`,
          }}
        >
          <div className="flex items-center border-r px-3 py-2 font-medium uppercase tracking-wide text-muted-foreground">
            Выставка
          </div>
          {Array.from({ length: totalDays }, (_, i) => {
            const dayNum = i + 1;
            const date = new Date(year, month, dayNum);
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isToday = dayNum === todayIndex;
            return (
              <div
                key={dayNum}
                className={`flex min-w-0 flex-col items-center justify-center border-r py-1 text-[10px] tabular-nums ${
                  isWeekend ? "bg-muted/40" : ""
                } ${isToday ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}
                title={date.toLocaleDateString("ru-RU", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              >
                <span className="leading-none">{dayNum}</span>
                <span className="leading-none text-[9px] opacity-70">
                  {["вс", "пн", "вт", "ср", "чт", "пт", "сб"][dow]}
                </span>
              </div>
            );
          })}
        </div>

        {isEmpty ? (
          <EmptyGridBody
            year={year}
            month={month}
            totalDays={totalDays}
            todayIndex={todayIndex}
            text={emptyText}
          />
        ) : null}

        {sortedExpos.map((expo, rowIndex) => {
          const phases = phasesOf(expo);
          const deals = dealsByExpoId?.get(Number(expo.id)) ?? [];
          return (
            <ExpoRow
              key={expo.id}
              expo={expo}
              rowIndex={rowIndex}
              year={year}
              month={month}
              totalDays={totalDays}
              phases={phases}
              deals={deals}
              onSelectExpo={onSelectExpo}
              onSelectDeal={onSelectDeal}
            />
          );
        })}

        <LegendBar />
      </div>
    </div>
  );
}

function ExpoRow({
  expo,
  rowIndex,
  year,
  month,
  totalDays,
  phases,
  deals,
  onSelectExpo,
  onSelectDeal,
}: {
  expo: ExpoItem;
  rowIndex: number;
  year: number;
  month: number;
  totalDays: number;
  phases: Phase[];
  deals: BuildScheduleDeal[];
  onSelectExpo: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
}) {
  const dealsCount = deals.length;
  const stackHeight =
    dealsCount > 0
      ? DEAL_STACK_PAD_Y * 2 +
        dealsCount * DEAL_BAR_HEIGHT +
        (dealsCount - 1) * DEAL_BAR_GAP
      : 0;
  const rowHeight = Math.max(DAY_HEIGHT_BASE, stackHeight);

  const dealRange = expoOverallRange(expo);
  const dealClip = dealRange ? clipToMonth(dealRange, year, month) : undefined;

  return (
    <div
      className={`grid min-w-0 items-stretch border-b ${rowIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      style={{
        gridTemplateColumns: `${LEFT_COL_PX}px repeat(${totalDays}, minmax(0, 1fr))`,
        minHeight: `${rowHeight}px`,
      }}
      data-testid={`build-schedule-row-${expo.id}`}
    >
      <button
        type="button"
        onClick={() => onSelectExpo(expo)}
        className="flex flex-col justify-center border-r bg-background/70 px-3 py-2 text-left text-sm hover:bg-accent/60"
        data-testid={`build-schedule-left-${expo.id}`}
        title={expo.title}
      >
        <div className="truncate font-medium">{expo.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatShortRange(expo.expoStart, expo.expoEnd)}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Сделок: {dealsCount}
        </div>
      </button>
      <div
        className="relative col-span-full -col-start-2 row-span-1"
        style={{
          gridColumn: `2 / span ${totalDays}`,
          minHeight: `${rowHeight}px`,
        }}
      >
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))`,
          }}
          aria-hidden
        >
          {Array.from({ length: totalDays }, (_, i) => {
            const dayNum = i + 1;
            const date = new Date(year, month, dayNum);
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;
            return (
              <div
                key={dayNum}
                className={`border-r border-border/40 ${isWeekend ? "bg-muted/30" : ""}`}
              />
            );
          })}
        </div>

        {phases.map((phase) => {
          const clip = clipToMonth(phase, year, month);
          if (!clip) return null;
          const left = ((clip.startDay - 1) / totalDays) * 100;
          const width = ((clip.endDay - clip.startDay + 1) / totalDays) * 100;
          return (
            <div
              key={phase.key}
              className="pointer-events-none absolute inset-y-0"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: PHASE_FILLS[phase.key],
              }}
              title={`${phaseLabel(phase.key)}: ${formatShort(phase.start)} — ${formatShort(phase.end)}`}
              data-testid={`build-schedule-phase-${expo.id}-${phase.key}`}
            />
          );
        })}

        {dealClip
          ? deals.map((deal, idx) => {
              const left = ((dealClip.startDay - 1) / totalDays) * 100;
              const width =
                ((dealClip.endDay - dealClip.startDay + 1) / totalDays) * 100;
              const top =
                DEAL_STACK_PAD_Y + idx * (DEAL_BAR_HEIGHT + DEAL_BAR_GAP);
              return (
                <button
                  key={deal.id}
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (onSelectDeal) onSelectDeal(deal);
                    else if (deal.bitrixUrl)
                      window.open(deal.bitrixUrl, "_blank");
                  }}
                  className="absolute z-10 truncate rounded px-1 text-left text-[11px] leading-tight text-white shadow-sm transition hover:brightness-110"
                  style={{
                    top: `${top}px`,
                    height: `${DEAL_BAR_HEIGHT}px`,
                    left: `${left}%`,
                    width: `${width}%`,
                    background: dealColor(deal),
                  }}
                  title={dealSummaryLine(deal)}
                  data-testid={`build-schedule-deal-${deal.id}`}
                >
                  <span className="truncate">{dealSummaryLine(deal)}</span>
                </button>
              );
            })
          : null}

        <button
          type="button"
          onClick={() => onSelectExpo(expo)}
          className="absolute inset-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label={`Открыть ${expo.title}`}
        />
      </div>
    </div>
  );
}

function EmptyGridBody({
  year,
  month,
  totalDays,
  todayIndex,
  text,
}: {
  year: number;
  month: number;
  totalDays: number;
  todayIndex: number;
  text: string;
}) {
  return (
    <div
      className="relative grid min-w-0 items-stretch border-b"
      style={{
        gridTemplateColumns: `${LEFT_COL_PX}px repeat(${totalDays}, minmax(0, 1fr))`,
        minHeight: `${DAY_HEIGHT_BASE * 2}px`,
      }}
    >
      <div className="border-r bg-background/70" aria-hidden />
      {Array.from({ length: totalDays }, (_, i) => {
        const dayNum = i + 1;
        const date = new Date(year, month, dayNum);
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isToday = dayNum === todayIndex;
        return (
          <div
            key={dayNum}
            className={`border-r border-border/40 ${isWeekend ? "bg-muted/30" : ""} ${
              isToday ? "bg-primary/5" : ""
            }`}
            aria-hidden
          />
        );
      })}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground"
        data-testid="build-schedule-empty"
      >
        {text}
      </div>
    </div>
  );
}

function MonthControls({
  cursor,
  onPrev,
  onNext,
  onToday,
  onSelect,
  yearOptions,
}: {
  cursor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelect: (d: Date) => void;
  yearOptions: number[];
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={onPrev}
        aria-label="Предыдущий месяц"
        data-testid="build-schedule-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onToday}
        data-testid="build-schedule-today"
      >
        Сегодня
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onNext}
        aria-label="Следующий месяц"
        data-testid="build-schedule-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Select
        value={String(month)}
        onValueChange={(v) => onSelect(monthStartOf(year, Number(v)))}
      >
        <SelectTrigger className="w-[160px]" data-testid="build-schedule-month">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONTH_NAMES_RU.map((name, idx) => (
            <SelectItem key={idx} value={String(idx)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(year)}
        onValueChange={(v) => onSelect(monthStartOf(Number(v), month))}
      >
        <SelectTrigger className="w-[120px]" data-testid="build-schedule-year">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {yearOptions.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto text-sm text-muted-foreground">
        {MONTH_NAMES_RU[month]} {year}
      </div>
    </div>
  );
}

function LegendBar() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <LegendSwatch color={PHASE_FILLS.mount} label="Монтаж" />
      <LegendSwatch color={PHASE_FILLS.expo} label="Работа выставки" />
      <LegendSwatch color={PHASE_FILLS.dismantle} label="Демонтаж" />
      <span className="mx-2 h-3 w-px bg-border" aria-hidden />
      {DEAL_STATUS_ORDER.map((key) => (
        <LegendSwatch
          key={key}
          color={DEAL_STATUS_COLORS[key]}
          label={DEAL_STATUS_LABELS[key as DealStatusKey]}
        />
      ))}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-3 w-4 rounded border border-border/60"
        style={{ background: color }}
      />
      <span>{label}</span>
    </span>
  );
}

function phaseLabel(key: "mount" | "expo" | "dismantle") {
  return key === "mount" ? "Монтаж" : key === "expo" ? "Проведение" : "Демонтаж";
}

function formatShort(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatShortRange(from: unknown, to: unknown): string {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a && !b) return "даты не указаны";
  if (a && !b) return formatShort(a);
  if (!a && b) return formatShort(b);
  return `${formatShort(a!)} — ${formatShort(b!)}`;
}
