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
  daysInYear,
  monthSegments,
  type MonthSegment,
} from "@/lib/build-schedule-months";

const LEFT_COL_PX = 260;

const HEADER_ROW_HEIGHT = 18;
const DEAL_ROW_HEIGHT = 18;
const ROW_PADDING_Y = 6;
const NEUTRAL_BAR_COLOR = "#94a3b8";

type Range = { start: Date; end: Date };

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = stripTime(d).getTime() - stripTime(start).getTime();
  return Math.floor(diff / 86_400_000);
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
  return { start: start!, end: end! };
}

// Position a range inside the requested year as left/width percentages.
// Clips on year edges so cross-year exhibitions still render.
function clipToYear(
  range: Range | undefined,
  year: number,
): { leftPct: number; widthPct: number } | undefined {
  if (!range) return undefined;
  const yearStart = stripTime(new Date(year, 0, 1)).getTime();
  const yearEnd = stripTime(new Date(year, 11, 31)).getTime();
  const s = stripTime(range.start).getTime();
  const e = stripTime(range.end).getTime();
  if (e < yearStart || s > yearEnd) return undefined;
  const clippedStart = Math.max(s, yearStart);
  const clippedEnd = Math.min(e, yearEnd);
  const total = daysInYear(year);
  const startDayIdx = Math.floor((clippedStart - yearStart) / 86_400_000);
  const endDayIdx = Math.floor((clippedEnd - yearStart) / 86_400_000);
  const leftPct = (startDayIdx / total) * 100;
  const widthPct = Math.max(0.3, ((endDayIdx - startDayIdx + 1) / total) * 100);
  return { leftPct, widthPct };
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

// Filter expos whose phases touch the year [y-01-01, y-12-31].
function expoTouchesYear(expo: ExpoItem, year: number): boolean {
  const range = expoOverallRange(expo);
  if (!range) return false;
  return (
    range.start.getFullYear() <= year && range.end.getFullYear() >= year
  );
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
    () => [...expos].filter((e) => expoTouchesYear(e, year)).sort(compareExpos),
    [expos, year],
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
  const todayLeftPct =
    today.getFullYear() === year
      ? (dayOfYear(today) / daysInYear(year)) * 100
      : undefined;

  const months = useMemo(() => monthSegments(year), [year]);

  const isEmpty = sortedExpos.length === 0;
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

      <div className="mt-3 overflow-hidden rounded-md border bg-background">
        <YearHeader year={year} todayLeftPct={todayLeftPct} months={months} />

        {isEmpty ? (
          <EmptyGridBody
            text={emptyText}
            todayLeftPct={todayLeftPct}
            months={months}
          />
        ) : null}

        {sortedExpos.map((expo, rowIndex) => {
          const deals = dealsByExpoId?.get(Number(expo.id)) ?? [];
          return (
            <BuildScheduleRow
              key={expo.id}
              expo={expo}
              deals={deals}
              rowIndex={rowIndex}
              year={year}
              todayLeftPct={todayLeftPct}
              months={months}
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

function YearHeader({
  year,
  todayLeftPct,
  months,
}: {
  year: number;
  todayLeftPct: number | undefined;
  months: MonthSegment[];
}) {
  return (
    <div
      className="relative grid min-w-0 items-stretch border-b bg-muted/40 text-xs"
      style={{ gridTemplateColumns: `${LEFT_COL_PX}px 1fr` }}
    >
      <div className="flex items-center border-r px-3 py-2 font-medium uppercase tracking-wide text-muted-foreground">
        Выставка · сделки
      </div>
      <div className="relative h-7">
        {months.map((m) => (
          <div
            key={m.index}
            className="absolute inset-y-0 flex items-center justify-center border-r border-border/70 text-[11px] font-medium uppercase tracking-wide text-muted-foreground last:border-r-0"
            style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
            title={`${m.name} ${year}`}
          >
            <span className="truncate px-1">{m.name}</span>
          </div>
        ))}
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

// Vertical month columns shown behind row content: alternating shading and
// dividers so the year reads as 12 month groups without offsetting bars.
function MonthGridBackdrop({ months }: { months: MonthSegment[] }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {months.map((m) => (
        <div
          key={m.index}
          className={`absolute inset-y-0 border-r border-border/40 last:border-r-0 ${
            m.index % 2 === 1 ? "bg-muted/30" : ""
          }`}
          style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
        />
      ))}
    </div>
  );
}

function BuildScheduleRow({
  expo,
  deals,
  rowIndex,
  year,
  todayLeftPct,
  months,
  onSelectExpo,
  onSelectDeal,
}: {
  expo: ExpoItem;
  deals: BuildScheduleDeal[];
  rowIndex: number;
  year: number;
  todayLeftPct: number | undefined;
  months: MonthSegment[];
  onSelectExpo: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
}) {
  const overall = expoOverallRange(expo);
  const clip = clipToYear(overall, year);
  const dealsCount = deals.length;
  const innerHeight =
    ROW_PADDING_Y * 2 +
    HEADER_ROW_HEIGHT +
    Math.max(0, dealsCount) * DEAL_ROW_HEIGHT +
    Math.max(0, dealsCount - 1) * 2;

  return (
    <div
      className={`grid min-w-0 items-stretch border-b ${rowIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      style={{
        gridTemplateColumns: `${LEFT_COL_PX}px 1fr`,
        minHeight: `${Math.max(56, innerHeight)}px`,
      }}
      data-testid={`build-schedule-row-${expo.id}`}
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
      <div
        className="relative"
        style={{ minHeight: `${innerHeight}px` }}
      >
        <MonthGridBackdrop months={months} />
        {todayLeftPct !== undefined ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-primary/40"
            style={{ left: `${todayLeftPct}%` }}
            aria-hidden
          />
        ) : null}

        {clip ? (
          <div
            className="absolute rounded"
            style={{
              top: `${ROW_PADDING_Y}px`,
              height: `${HEADER_ROW_HEIGHT}px`,
              left: `${clip.leftPct}%`,
              width: `${clip.widthPct}%`,
              background: PHASE_FILLS.expo,
              border: "1px solid rgba(34,197,94,0.45)",
            }}
            title={`${expo.title} · ${formatShort(overall!.start)} — ${formatShort(overall!.end)}`}
          />
        ) : null}

        {deals.map((deal, idx) => {
          const dealClip = clip;
          if (!dealClip) return null;
          const top =
            ROW_PADDING_Y + HEADER_ROW_HEIGHT + 4 + idx * (DEAL_ROW_HEIGHT + 2);
          return (
            <button
              key={deal.id}
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                if (onSelectDeal) onSelectDeal(deal);
                else if (deal.bitrixUrl) window.open(deal.bitrixUrl, "_blank");
              }}
              className="absolute truncate rounded px-1 text-left text-[11px] leading-tight text-white shadow-sm transition hover:brightness-110"
              style={{
                top: `${top}px`,
                height: `${DEAL_ROW_HEIGHT}px`,
                left: `${dealClip.leftPct}%`,
                width: `${dealClip.widthPct}%`,
                background: dealColor(deal),
              }}
              title={dealSummaryLine(deal)}
              data-testid={`build-schedule-deal-${deal.id}`}
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

function EmptyGridBody({
  text,
  todayLeftPct,
  months,
}: {
  text: string;
  todayLeftPct: number | undefined;
  months: MonthSegment[];
}) {
  return (
    <div
      className="relative grid min-w-0 items-stretch border-b"
      style={{ gridTemplateColumns: `${LEFT_COL_PX}px 1fr`, minHeight: "112px" }}
    >
      <div className="border-r bg-background/70" aria-hidden />
      <div className="relative">
        <MonthGridBackdrop months={months} />
        {todayLeftPct !== undefined ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-primary/40"
            style={{ left: `${todayLeftPct}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground"
        data-testid="build-schedule-empty"
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
    <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <LegendSwatch color={PHASE_FILLS.expo} label="Период выставки" />
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
