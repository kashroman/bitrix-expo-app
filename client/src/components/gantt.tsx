import { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PHASE_FILLS, matchDealStatus } from "@/lib/config";
import { ExpoItem } from "@/lib/expo-data";
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
}: {
  expos: ExpoItem[];
  onSelect: (expo: ExpoItem) => void;
  renderRight?: (expo: ExpoItem) => React.ReactNode;
  initialMonth?: Date;
  onMonthChange?: (monthStart: Date) => void;
  emptyMessage?: string;
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
          return (
            <ExpoRow
              key={expo.id}
              expo={expo}
              rowIndex={rowIndex}
              year={year}
              month={month}
              totalDays={totalDays}
              phases={phases}
              rowHeight={DAY_HEIGHT_BASE}
              onSelect={onSelect}
              renderRight={renderRight}
            />
          );
        })}

        <GanttLegendBar />
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
  onSelect,
  renderRight,
}: {
  expo: ExpoItem;
  rowIndex: number;
  year: number;
  month: number;
  totalDays: number;
  phases: Phase[];
  rowHeight: number;
  onSelect: (expo: ExpoItem) => void;
  renderRight?: (expo: ExpoItem) => React.ReactNode;
}) {
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
              className="absolute top-1 bottom-1 rounded"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: PHASE_FILLS[phase.key],
              }}
              title={`${phaseLabel(phase.key)}: ${formatShort(phase.start)} — ${formatShort(phase.end)}`}
            />
          );
        })}

        <button
          type="button"
          onClick={() => onSelect(expo)}
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

function GanttLegendBar() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <LegendSwatch color={PHASE_FILLS.mount} label="Монтаж" />
      <LegendSwatch color={PHASE_FILLS.expo} label="Проведение" />
      <LegendSwatch color={PHASE_FILLS.dismantle} label="Демонтаж" />
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
