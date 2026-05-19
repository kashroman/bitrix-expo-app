import { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEAL_STATUS_COLORS,
  PHASE_FILLS,
  matchDealStatus,
} from "@/lib/config";
import { BuildScheduleDeal, ExpoItem } from "@/lib/expo-data";
import { parseDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LEFT_COL_PX = 240;
const DEAL_BAR_HEIGHT = 18;
const DEAL_BAR_GAP = 3;
const DEAL_STACK_PAD_Y = 6;
const NEUTRAL_BAR_COLOR = "#94a3b8";
const STAGE_FALLBACK_PALETTE = [
  "#a855f7", // purple
  "#0ea5e9", // sky
  "#f97316", // orange
  "#14b8a6", // teal
  "#ec4899", // pink
  "#22c55e", // green
  "#facc15", // yellow
  "#ef4444", // red
  "#6366f1", // indigo
  "#84cc16", // lime
];

// Deterministic colour for stage IDs the matcher doesn't know about. Keeps
// custom stages visually distinguishable without per-stage configuration.
export function stageFallbackColor(stageId: string | undefined | null): string {
  const s = String(stageId ?? "").trim();
  if (!s) return NEUTRAL_BAR_COLOR;
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return STAGE_FALLBACK_PALETTE[hash % STAGE_FALLBACK_PALETTE.length];
}

function dealColor(deal: BuildScheduleDeal): string {
  if (deal.status && DEAL_STATUS_COLORS[deal.status]) {
    return DEAL_STATUS_COLORS[deal.status];
  }
  return stageFallbackColor(deal.stageTail || deal.stageId);
}

function dealStageLabel(
  deal: BuildScheduleDeal,
  stageTitles?: Map<string, string>,
): string {
  if (stageTitles) {
    const t =
      stageTitles.get(deal.stageId) ??
      stageTitles.get(deal.stageTail ?? "") ??
      stageTitles.get(deal.stageTail ?? "");
    if (t) return t;
  }
  return deal.stageTail || deal.stageId || "—";
}

function dealSummaryLine(
  deal: BuildScheduleDeal,
  stageTitles?: Map<string, string>,
): string {
  const parts: string[] = [];
  if (deal.clientName) parts.push(deal.clientName);
  else parts.push(deal.title);
  if (deal.manager) parts.push(deal.manager);
  if (deal.budget) parts.push(deal.budget);
  parts.push(dealStageLabel(deal, stageTitles));
  return parts.join(" · ");
}

// Compute the visible row height required to stack `count` deal bars on top of
// the phase background. Always ≥ the base day-row height.
export function dealRowHeight(count: number, base: number = DAY_HEIGHT_BASE): number {
  if (count <= 0) return base;
  const stack =
    DEAL_STACK_PAD_Y * 2 +
    count * DEAL_BAR_HEIGHT +
    (count - 1) * DEAL_BAR_GAP;
  return Math.max(base, stack);
}

// Span the deal across the exhibition's full mount→dismantle interval (same
// behaviour as the old BuildScheduleView: a deal occupies the whole row of
// its expo, clipped to the visible month).
export function expoOverallRange(
  expo: ExpoItem,
): { start: Date; end: Date } | undefined {
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
const DAY_HEIGHT_BASE = 56;

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
  if (mountStart && mountEnd) result.push({ key: "mount", start: mountStart, end: mountEnd });
  if (expoStart && expoEnd) result.push({ key: "expo", start: expoStart, end: expoEnd });
  const dismantleStart = parseDate(expo.dismantleStart) ?? expoEnd;
  const dismantleEnd = parseDate(expo.dismantleEnd) ?? dismantleStart;
  if (dismantleStart && dismantleEnd) result.push({ key: "dismantle", start: dismantleStart, end: dismantleEnd });
  return result;
}

// Clip a [start, end] range (by day) to the 1..N day index of the selected month.
// Returns inclusive 1-based startDay/endDay or undefined if disjoint.
function clipToMonth(
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

export function GanttTimeline({
  expos,
  onSelect,
  renderRight,
  initialMonth,
  onMonthChange,
  emptyMessage,
  dealsByExpoId,
  onSelectDeal,
  stageTitles,
  selectedStageIds,
}: {
  expos: ExpoItem[];
  onSelect: (expo: ExpoItem) => void;
  renderRight?: (expo: ExpoItem) => React.ReactNode;
  initialMonth?: Date;
  onMonthChange?: (monthStart: Date) => void;
  emptyMessage?: string;
  dealsByExpoId?: Map<number, BuildScheduleDeal[]>;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
  stageTitles?: Map<string, string>;
  selectedStageIds?: string[];
}) {
  const [cursor, setCursor] = useState<Date>(() => {
    if (initialMonth) return monthStartOf(initialMonth.getFullYear(), initialMonth.getMonth());
    const now = new Date();
    return monthStartOf(now.getFullYear(), now.getMonth());
  });

  // Keep cursor in sync when the parent drives the month externally (e.g.
  // deep-link, refresh, or a sibling control). Using the year/month pair
  // as the dependency avoids re-syncing on every new Date reference that
  // represents the same month — which would otherwise fight with user
  // clicks on the prev/next buttons.
  const initialYear = initialMonth?.getFullYear();
  const initialMonthIdx = initialMonth?.getMonth();
  useEffect(() => {
    if (initialYear === undefined || initialMonthIdx === undefined) return;
    setCursor((prev) => {
      if (prev.getFullYear() === initialYear && prev.getMonth() === initialMonthIdx) {
        return prev;
      }
      return monthStartOf(initialYear, initialMonthIdx);
    });
  }, [initialYear, initialMonthIdx]);

  useEffect(() => {
    onMonthChange?.(cursor);
  }, [cursor, onMonthChange]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const totalDays = daysInMonth(year, month);

  const sortedExpos = useMemo(() => {
    return [...expos].sort((a, b) => {
      const sa = parseDate(a.expoStart)?.getTime() ?? Number.POSITIVE_INFINITY;
      const sb = parseDate(b.expoStart)?.getTime() ?? Number.POSITIVE_INFINITY;
      if (sa === sb) return a.title.localeCompare(b.title, "ru-RU");
      return sa - sb;
    });
  }, [expos]);

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
    return Array.from(set).sort((a, b) => a - b);
  }, [expos]);

  const goPrev = () => setCursor(monthStartOf(year, month - 1));
  const goNext = () => setCursor(monthStartOf(year, month + 1));
  const goToday = () => {
    const now = new Date();
    setCursor(monthStartOf(now.getFullYear(), now.getMonth()));
  };

  const today = stripTime(new Date());
  const todayIndex =
    today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;

  const isEmpty = sortedExpos.length === 0;
  const emptyText = emptyMessage ?? "Нет выставок для отображения.";

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
                title={date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
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
          const rowHeight = dealRowHeight(deals.length);
          return (
            <ExpoRow
              key={expo.id}
              expo={expo}
              rowIndex={rowIndex}
              year={year}
              month={month}
              totalDays={totalDays}
              phases={phases}
              rowHeight={rowHeight}
              deals={deals}
              onSelect={onSelect}
              onSelectDeal={onSelectDeal}
              stageTitles={stageTitles}
              renderRight={renderRight}
            />
          );
        })}

        <GanttLegendBar
          selectedStageIds={selectedStageIds}
          stageTitles={stageTitles}
        />
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
  rowHeight,
  deals,
  onSelect,
  onSelectDeal,
  stageTitles,
  renderRight,
}: {
  expo: ExpoItem;
  rowIndex: number;
  year: number;
  month: number;
  totalDays: number;
  phases: Phase[];
  rowHeight: number;
  deals?: BuildScheduleDeal[];
  onSelect: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
  stageTitles?: Map<string, string>;
  renderRight?: (expo: ExpoItem) => React.ReactNode;
}) {
  const dealList = deals ?? [];
  const dealRange = dealList.length > 0 ? expoOverallRange(expo) : undefined;
  const dealClip = dealRange ? clipToMonth(dealRange, year, month) : undefined;
  return (
    <div
      className={`grid min-w-0 items-stretch border-b ${rowIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      style={{
        gridTemplateColumns: `${LEFT_COL_PX}px repeat(${totalDays}, minmax(0, 1fr))`,
        minHeight: `${rowHeight}px`,
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(expo)}
        className="flex flex-col justify-center border-r bg-background/70 px-3 py-2 text-left text-sm hover:bg-accent/60"
        data-testid={`gantt-row-${expo.id}`}
        title={expo.title}
      >
        <div className="truncate font-medium">{expo.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatShortRange(expo.expoStart, expo.expoEnd)}
        </div>
        {dealList.length > 0 ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            Сделок: {dealList.length}
          </div>
        ) : null}
        {renderRight ? <div className="mt-0.5 truncate">{renderRight(expo)}</div> : null}
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
              data-testid={`gantt-phase-${expo.id}-${phase.key}`}
            />
          );
        })}

        <button
          type="button"
          onClick={() => onSelect(expo)}
          className="absolute inset-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label={`Открыть ${expo.title}`}
        />

        {dealClip
          ? dealList.map((deal, idx) => {
              const left = ((dealClip.startDay - 1) / totalDays) * 100;
              const width =
                ((dealClip.endDay - dealClip.startDay + 1) / totalDays) * 100;
              const top =
                DEAL_STACK_PAD_Y + idx * (DEAL_BAR_HEIGHT + DEAL_BAR_GAP);
              const summary = dealSummaryLine(deal, stageTitles);
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
                  title={summary}
                  data-testid={`gantt-deal-${deal.id}`}
                >
                  <span className="truncate">{summary}</span>
                </button>
              );
            })
          : null}
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
        data-testid="gantt-empty"
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
      <Button variant="outline" size="icon" onClick={onPrev} aria-label="Предыдущий месяц" data-testid="gantt-prev">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={onToday} data-testid="gantt-today">
        Сегодня
      </Button>
      <Button variant="outline" size="icon" onClick={onNext} aria-label="Следующий месяц" data-testid="gantt-next">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Select
        value={String(month)}
        onValueChange={(v) => onSelect(monthStartOf(year, Number(v)))}
      >
        <SelectTrigger className="w-[160px]" data-testid="gantt-month"><SelectValue /></SelectTrigger>
        <SelectContent>
          {MONTH_NAMES_RU.map((name, idx) => (
            <SelectItem key={idx} value={String(idx)}>{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(year)}
        onValueChange={(v) => onSelect(monthStartOf(Number(v), month))}
      >
        <SelectTrigger className="w-[120px]" data-testid="gantt-year"><SelectValue /></SelectTrigger>
        <SelectContent>
          {yearOptions.map((y) => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto text-sm text-muted-foreground">
        {MONTH_NAMES_RU[month]} {year}
      </div>
    </div>
  );
}

function GanttLegendBar({
  selectedStageIds,
  stageTitles,
}: {
  selectedStageIds?: string[];
  stageTitles?: Map<string, string>;
}) {
  const stageSwatches = (selectedStageIds ?? []).map((id) => {
    const known = matchDealStatus(id, stageTitles?.get(id));
    const color = known
      ? DEAL_STATUS_COLORS[known]
      : stageFallbackColor(id);
    const label = stageTitles?.get(id) ?? id;
    return { id, color, label };
  });
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <LegendSwatch color={PHASE_FILLS.mount} label="Монтаж" />
      <LegendSwatch color={PHASE_FILLS.expo} label="Проведение" />
      <LegendSwatch color={PHASE_FILLS.dismantle} label="Демонтаж" />
      {stageSwatches.length > 0 ? (
        <span className="mx-2 h-3 w-px bg-border" aria-hidden />
      ) : null}
      {stageSwatches.map((s) => (
        <LegendSwatch key={s.id} color={s.color} label={s.label} />
      ))}
    </div>
  );
}

export function GanttLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <LegendSwatch color={PHASE_FILLS.mount} label="Монтаж" />
      <LegendSwatch color={PHASE_FILLS.expo} label="Проведение" />
      <LegendSwatch color={PHASE_FILLS.dismantle} label="Демонтаж" />
    </div>
  );
}

function LegendSwatch({ color, label, solid }: { color: string; label: string; solid?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`h-3 w-4 rounded ${solid ? "" : "border border-border/60"}`}
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
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatShortRange(from: unknown, to: unknown): string {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a && !b) return "даты не указаны";
  if (a && !b) return formatShort(a);
  if (!a && b) return formatShort(b);
  return `${formatShort(a!)} — ${formatShort(b!)}`;
}

// Re-export helper for the deal-status matcher so consumers can import from
// gantt-related code without pulling config directly when they already have
// the stage text. Kept inline to avoid extra lib files.
export { matchDealStatus };
