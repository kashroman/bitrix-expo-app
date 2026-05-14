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
import {
  MONTH_NAMES_RU_SHORT,
  clipToMonth,
  monthBounds,
  percentWithinMonth,
  type MonthBounds,
} from "@/lib/build-schedule-months";

const LEFT_COL_PX = 260;

const DEAL_ROW_HEIGHT = 18;
const DEAL_ROW_GAP = 3;
const ROW_PADDING_Y = 6;
const MIN_ROW_HEIGHT = 44;
const NEUTRAL_BAR_COLOR = "#94a3b8";

type Range = { start: Date; end: Date };

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function rangeFromDates(a: unknown, b: unknown): Range | undefined {
  const start = parseDate(a);
  const end = parseDate(b);
  if (!start && !end) return undefined;
  const s = start ?? end!;
  const e = end ?? start!;
  return { start: stripTime(s), end: stripTime(e) };
}

function expoOverallRange(expo: ExpoItem): Range | undefined {
  const starts = [
    parseDate(expo.installStart),
    parseDate(expo.expoStart),
  ].filter(Boolean) as Date[];
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

function expoPhases(expo: ExpoItem): {
  mount?: Range;
  expo?: Range;
  dismantle?: Range;
} {
  return {
    mount: rangeFromDates(expo.installStart, expo.installEnd),
    expo: rangeFromDates(expo.expoStart, expo.expoEnd),
    dismantle: rangeFromDates(expo.dismantleStart, expo.dismantleEnd),
  };
}

function compareExpos(a: ExpoItem, b: ExpoItem): number {
  const sa = parseDate(a.expoStart)?.getTime() ?? Number.POSITIVE_INFINITY;
  const sb = parseDate(b.expoStart)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return a.title.localeCompare(b.title, "ru-RU");
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

function expoTouchesMonth(
  phases: ReturnType<typeof expoPhases>,
  bounds: MonthBounds,
): boolean {
  for (const r of [phases.mount, phases.expo, phases.dismantle]) {
    if (!r) continue;
    if (
      r.end.getTime() >= bounds.startMs &&
      r.start.getTime() <= bounds.endMs
    ) {
      return true;
    }
  }
  return false;
}

export function BuildScheduleView({
  expos,
  dealsByExpoId,
  initialYear,
  onYearChange,
  onSelectExpo,
  onSelectDeal,
  emptyMessage,
  isFetching,
}: {
  expos: ExpoItem[];
  dealsByExpoId: Map<number, BuildScheduleDeal[]> | undefined;
  initialYear?: number;
  onYearChange?: (year: number) => void;
  onSelectExpo: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
  emptyMessage?: string;
  isFetching?: boolean;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(() => initialYear ?? currentYear);

  useEffect(() => {
    if (initialYear === undefined) return;
    setYear((prev) => (prev === initialYear ? prev : initialYear));
  }, [initialYear]);

  useEffect(() => {
    onYearChange?.(year);
  }, [year, onYearChange]);

  const sortedExpos = useMemo(
    () => [...expos].sort(compareExpos),
    [expos],
  );

  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    for (let y = currentYear - 2; y <= currentYear + 3; y++) set.add(y);
    expos.forEach((expo) => {
      const s = parseDate(expo.expoStart);
      const e = parseDate(expo.expoEnd);
      if (s) set.add(s.getFullYear());
      if (e) set.add(e.getFullYear());
    });
    set.add(year);
    return Array.from(set).sort((a, b) => a - b);
  }, [expos, currentYear, year]);

  const goPrev = () => setYear((y) => y - 1);
  const goNext = () => setYear((y) => y + 1);
  const goToday = () => setYear(currentYear);

  const today = new Date();
  const todayMs = stripTime(today).getTime();
  const todayMonthIdx =
    today.getFullYear() === year ? today.getMonth() : undefined;

  const monthsBounds = useMemo(
    () => Array.from({ length: 12 }, (_, i) => monthBounds(year, i)),
    [year],
  );

  const emptyText =
    emptyMessage ??
    (isFetching
      ? "Загрузка сделок за выбранный год…"
      : "Нет выставок со сделками на стадиях графика застройки в этом году.");

  return (
    <div>
      <YearControls
        year={year}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onSelect={setYear}
        yearOptions={yearOptions}
      />

      <div
        className="mt-3 space-y-3"
        data-testid="build-schedule-month-blocks"
      >
        {monthsBounds.map((bounds) => {
          const monthExpos = sortedExpos.filter((expo) =>
            expoTouchesMonth(expoPhases(expo), bounds),
          );
          const showToday = todayMonthIdx === bounds.monthIdx;
          const todayLeftPct = showToday
            ? percentWithinMonth(todayMs, bounds)
            : undefined;
          return (
            <MonthBlock
              key={bounds.monthIdx}
              bounds={bounds}
              expos={monthExpos}
              dealsByExpoId={dealsByExpoId}
              todayLeftPct={todayLeftPct}
              onSelectExpo={onSelectExpo}
              onSelectDeal={onSelectDeal}
              emptyText={emptyText}
            />
          );
        })}

        <LegendBar />
      </div>
    </div>
  );
}

function MonthBlock({
  bounds,
  expos,
  dealsByExpoId,
  todayLeftPct,
  onSelectExpo,
  onSelectDeal,
  emptyText,
}: {
  bounds: MonthBounds;
  expos: ExpoItem[];
  dealsByExpoId: Map<number, BuildScheduleDeal[]> | undefined;
  todayLeftPct: number | undefined;
  onSelectExpo: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
  emptyText: string;
}) {
  const monthName = MONTH_NAMES_RU_SHORT[bounds.monthIdx];
  const isEmpty = expos.length === 0;
  return (
    <div
      className="overflow-hidden rounded-md border bg-background"
      data-testid={`build-schedule-month-${bounds.monthIdx}`}
    >
      <MonthHeader bounds={bounds} todayLeftPct={todayLeftPct} />
      {isEmpty ? (
        <EmptyMonthBody bounds={bounds} todayLeftPct={todayLeftPct} text={emptyText} />
      ) : (
        expos.map((expo, rowIndex) => {
          const deals = dealsByExpoId?.get(Number(expo.id)) ?? [];
          return (
            <ExpoMonthRow
              key={expo.id}
              expo={expo}
              deals={deals}
              rowIndex={rowIndex}
              bounds={bounds}
              todayLeftPct={todayLeftPct}
              onSelectExpo={onSelectExpo}
              onSelectDeal={onSelectDeal}
            />
          );
        })
      )}
      <div className="sr-only">{monthName} {bounds.year}</div>
    </div>
  );
}

function MonthHeader({
  bounds,
  todayLeftPct,
}: {
  bounds: MonthBounds;
  todayLeftPct: number | undefined;
}) {
  const monthName = MONTH_NAMES_RU_SHORT[bounds.monthIdx];
  // Show day ticks at 1, 8, 15, 22 and last day for orientation.
  const ticks = [1, 8, 15, 22, bounds.days].filter(
    (d, i, arr) => arr.indexOf(d) === i,
  );
  return (
    <div
      className="relative grid min-w-0 items-stretch border-b bg-muted/40 text-xs"
      style={{ gridTemplateColumns: `${LEFT_COL_PX}px 1fr` }}
    >
      <div className="flex items-center border-r px-3 py-2 font-medium uppercase tracking-wide text-foreground">
        <span className="text-sm normal-case">
          {monthName} {bounds.year}
        </span>
      </div>
      <div className="relative h-7">
        {ticks.map((day) => {
          const leftPct = ((day - 1) / bounds.days) * 100;
          return (
            <div
              key={day}
              className="absolute inset-y-0 flex items-center justify-start pl-1 text-[11px] font-medium text-muted-foreground"
              style={{ left: `${leftPct}%` }}
            >
              {day}
            </div>
          );
        })}
        {todayLeftPct !== undefined ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/70"
            style={{ left: `${todayLeftPct}%` }}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

function DayGridBackdrop({ bounds }: { bounds: MonthBounds }) {
  const lines = [8, 15, 22];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {lines.map((day) => {
        const leftPct = ((day - 1) / bounds.days) * 100;
        return (
          <div
            key={day}
            className="absolute inset-y-0 border-l border-border/40"
            style={{ left: `${leftPct}%` }}
          />
        );
      })}
    </div>
  );
}

function ExpoMonthRow({
  expo,
  deals,
  rowIndex,
  bounds,
  todayLeftPct,
  onSelectExpo,
  onSelectDeal,
}: {
  expo: ExpoItem;
  deals: BuildScheduleDeal[];
  rowIndex: number;
  bounds: MonthBounds;
  todayLeftPct: number | undefined;
  onSelectExpo: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
}) {
  const phases = expoPhases(expo);
  const dealsCount = deals.length;
  const innerHeight =
    ROW_PADDING_Y * 2 +
    Math.max(1, dealsCount) * DEAL_ROW_HEIGHT +
    Math.max(0, dealsCount - 1) * DEAL_ROW_GAP;
  const rowHeight = Math.max(MIN_ROW_HEIGHT, innerHeight);

  const phaseClips: Array<{
    key: "mount" | "expo" | "dismantle";
    clip: ReturnType<typeof clipToMonth>;
    color: string;
    border: string;
  }> = [
    {
      key: "mount",
      clip: phases.mount
        ? clipToMonth(phases.mount.start.getTime(), phases.mount.end.getTime(), bounds)
        : undefined,
      color: PHASE_FILLS.mount,
      border: "rgba(234,179,8,0.5)",
    },
    {
      key: "expo",
      clip: phases.expo
        ? clipToMonth(phases.expo.start.getTime(), phases.expo.end.getTime(), bounds)
        : undefined,
      color: PHASE_FILLS.expo,
      border: "rgba(34,197,94,0.5)",
    },
    {
      key: "dismantle",
      clip: phases.dismantle
        ? clipToMonth(
            phases.dismantle.start.getTime(),
            phases.dismantle.end.getTime(),
            bounds,
          )
        : undefined,
      color: PHASE_FILLS.dismantle,
      border: "rgba(239,68,68,0.5)",
    },
  ];

  // For deals: use the expo overall range as the deal span (mount→dismantle).
  const dealRange = expoOverallRange(expo);
  const dealClip = dealRange
    ? clipToMonth(dealRange.start.getTime(), dealRange.end.getTime(), bounds)
    : undefined;

  return (
    <div
      className={`grid min-w-0 items-stretch border-b last:border-b-0 ${rowIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      style={{
        gridTemplateColumns: `${LEFT_COL_PX}px 1fr`,
        minHeight: `${rowHeight}px`,
      }}
      data-testid={`build-schedule-row-${expo.id}-${bounds.monthIdx}`}
    >
      <button
        type="button"
        onClick={() => onSelectExpo(expo)}
        className="flex flex-col justify-center border-r bg-background/70 px-3 py-2 text-left text-sm hover:bg-accent/60"
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
      <div className="relative" style={{ minHeight: `${rowHeight}px` }}>
        <DayGridBackdrop bounds={bounds} />

        {phaseClips.map(({ key, clip, color, border }) =>
          clip ? (
            <div
              key={key}
              className="pointer-events-none absolute inset-y-0"
              style={{
                left: `${clip.leftPct}%`,
                width: `${clip.widthPct}%`,
                background: color,
                borderLeft: `1px solid ${border}`,
                borderRight: `1px solid ${border}`,
              }}
              aria-hidden
            />
          ) : null,
        )}

        {todayLeftPct !== undefined ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-primary/50"
            style={{ left: `${todayLeftPct}%` }}
            aria-hidden
          />
        ) : null}

        {deals.map((deal, idx) => {
          if (!dealClip) return null;
          const top = ROW_PADDING_Y + idx * (DEAL_ROW_HEIGHT + DEAL_ROW_GAP);
          return (
            <button
              key={deal.id}
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                if (onSelectDeal) onSelectDeal(deal);
                else if (deal.bitrixUrl) window.open(deal.bitrixUrl, "_blank");
              }}
              className="absolute z-10 truncate rounded px-1 text-left text-[11px] leading-tight text-white shadow-sm transition hover:brightness-110"
              style={{
                top: `${top}px`,
                height: `${DEAL_ROW_HEIGHT}px`,
                left: `${dealClip.leftPct}%`,
                width: `${dealClip.widthPct}%`,
                background: dealColor(deal),
              }}
              title={dealSummaryLine(deal)}
              data-testid={`build-schedule-deal-${deal.id}-${bounds.monthIdx}`}
            >
              <span className="truncate">{dealSummaryLine(deal)}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onSelectExpo(expo)}
          className="absolute inset-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
          style={{ background: "transparent", zIndex: 0 }}
          aria-label={`Открыть ${expo.title}`}
        />
      </div>
    </div>
  );
}

function EmptyMonthBody({
  bounds,
  todayLeftPct,
  text,
}: {
  bounds: MonthBounds;
  todayLeftPct: number | undefined;
  text: string;
}) {
  return (
    <div
      className="relative grid min-w-0 items-stretch"
      style={{ gridTemplateColumns: `${LEFT_COL_PX}px 1fr`, minHeight: "48px" }}
    >
      <div className="border-r bg-background/70" aria-hidden />
      <div className="relative">
        <DayGridBackdrop bounds={bounds} />
        {todayLeftPct !== undefined ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-primary/40"
            style={{ left: `${todayLeftPct}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground"
        data-testid={`build-schedule-month-empty-${bounds.monthIdx}`}
      >
        {text}
      </div>
    </div>
  );
}

function YearControls({
  year,
  onPrev,
  onNext,
  onToday,
  onSelect,
  yearOptions,
}: {
  year: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelect: (y: number) => void;
  yearOptions: number[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={onPrev}
        aria-label="Предыдущий год"
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
        Текущий год
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onNext}
        aria-label="Следующий год"
        data-testid="build-schedule-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Select
        value={String(year)}
        onValueChange={(v) => onSelect(Number(v))}
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
      <div className="ml-auto text-sm text-muted-foreground">{year}</div>
    </div>
  );
}

function LegendBar() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
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
