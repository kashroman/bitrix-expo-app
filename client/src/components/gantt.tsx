import { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  PHASE_FILLS,
} from "@/lib/config";
import {
  stageDisplayColor,
  stageFallbackColor,
} from "@/lib/stage-colors";
import { BuildScheduleDeal, ExpoItem } from "@/lib/expo-data";
import {
  ACCREDITATION_GROUPS,
  AccreditationGroupKey,
  AccreditationLevel,
} from "@/lib/expo-accreditation-fields";
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
export { stageFallbackColor } from "@/lib/stage-colors";

function dealColor(
  deal: BuildScheduleDeal,
  stageTitles?: Map<string, string>,
  stageColors?: Map<string, string>,
): string {
  const id = deal.stageId || deal.stageTail;
  const tail = deal.stageTail || deal.stageId;
  return stageDisplayColor(
    id,
    stageTitles?.get(id) ?? stageTitles?.get(tail),
    stageColors?.get(id) ?? stageColors?.get(tail),
  );
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

export function dealBarLabel(deal: BuildScheduleDeal): string {
  return deal.clientName || deal.title;
}

export function sortDealsByStage(
  deals: BuildScheduleDeal[],
  stageSorts?: Map<string, number>,
): BuildScheduleDeal[] {
  const sortOf = (deal: BuildScheduleDeal) =>
    stageSorts?.get(deal.stageId) ??
    stageSorts?.get(deal.stageTail) ??
    Number.MAX_SAFE_INTEGER;
  return deals.slice().sort((a, b) =>
    sortOf(a) - sortOf(b) ||
    dealBarLabel(a).localeCompare(dealBarLabel(b), "ru-RU") ||
    a.id - b.id,
  );
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
type AccreditationDeadline = {
  key: string;
  level: AccreditationLevel;
  label: string;
  date: Date;
};

export type AccreditationDeadlineGroup = {
  key: AccreditationGroupKey;
  label: string;
  deadlines: AccreditationDeadline[];
};

export type AccreditationSegment = AccreditationDeadline & {
  start: Date;
  end: Date;
};

const ACCREDITATION_LEVELS: Array<{ key: AccreditationLevel; label: string; className: string }> = [
  { key: "base", label: "0%", className: "bg-emerald-200 border-emerald-400 text-emerald-950" },
  { key: "fifty", label: "+50%", className: "bg-amber-200 border-amber-400 text-amber-950" },
  { key: "hundred", label: "+100%", className: "bg-red-200 border-red-400 text-red-950" },
];

function levelMeta(level: AccreditationLevel) {
  return ACCREDITATION_LEVELS.find((item) => item.key === level)!;
}

export function accreditationDeadlineGroups(expo: ExpoItem): AccreditationDeadlineGroup[] {
  const data = expo.accreditation;
  if (!data) return [];
  return ACCREDITATION_GROUPS.flatMap((group) => {
    const source = data[group.key];
    const deadlines = ACCREDITATION_LEVELS.flatMap((level) => {
      const date = parseDate(source?.[level.key]);
      return date
        ? [{
            key: `${group.key}-${level.key}`,
            level: level.key,
            label: level.label,
            date,
          }]
        : [];
    });
    return deadlines.length ? [{ key: group.key, label: group.label, deadlines }] : [];
  });
}

// Kept as a compact flat view for code which only needs all deadline points.
export function accreditationDeadlines(expo: ExpoItem): AccreditationDeadline[] {
  return accreditationDeadlineGroups(expo).flatMap((group) => group.deadlines);
}

function addDays(date: Date, days: number): Date {
  const result = stripTime(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isAccreditationBaseVisibleInMonth(baseDeadline: Date, year: number, month: number): boolean {
  const deadlineMonth = new Date(baseDeadline.getFullYear(), baseDeadline.getMonth(), 1);
  const previousMonth = new Date(baseDeadline.getFullYear(), baseDeadline.getMonth() - 1, 1);
  return (
    (deadlineMonth.getFullYear() === year && deadlineMonth.getMonth() === month) ||
    (previousMonth.getFullYear() === year && previousMonth.getMonth() === month)
  );
}

// Every configured date is the last day of the corresponding coefficient.
// The next coefficient starts on the following day.  A 0% period has no
// stored start date, so it starts at the left edge of the visible month and
// is deliberately limited to the deadline month and the preceding month.
export function accreditationSegmentsForMonth(
  group: AccreditationDeadlineGroup,
  year: number,
  month: number,
): AccreditationSegment[] {
  const result: AccreditationSegment[] = [];
  const visibleStart = monthStartOf(year, month);
  const visibleEnd = monthEndOf(year, month);
  let previousEnd: Date | undefined;
  for (const deadline of group.deadlines) {
    if (deadline.level === "base" && !isAccreditationBaseVisibleInMonth(deadline.date, year, month)) {
      previousEnd = deadline.date;
      continue;
    }
    const start = previousEnd
      ? addDays(previousEnd, 1)
      : monthStartOf(year, month);
    if (start <= deadline.date && start <= visibleEnd && deadline.date >= visibleStart) {
      result.push({ ...deadline, start, end: deadline.date });
    }
    previousEnd = deadline.date;
  }
  return result;
}

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
  stageColors,
  stageSorts,
  selectedStageIds,
  showAccreditation,
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
  stageColors?: Map<string, string>;
  stageSorts?: Map<string, number>;
  selectedStageIds?: string[];
  showAccreditation?: boolean;
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
          const deals = sortDealsByStage(
            dealsByExpoId?.get(Number(expo.id)) ?? [],
            stageSorts,
          );
          const accreditationRows = showAccreditation ? accreditationDeadlineGroups(expo).length : 0;
          const accreditationHeight = accreditationRows ? 8 + accreditationRows * 22 : 0;
          const rowHeight = Math.max(
            dealRowHeight(deals.length) + accreditationHeight,
            DAY_HEIGHT_BASE + accreditationHeight,
          );
          return (
            <ExpoRow
              key={expo.id}
              expo={expo}
              rowIndex={rowIndex}
              year={year}
              month={month}
              totalDays={totalDays}
              todayIndex={todayIndex}
              phases={phases}
              rowHeight={rowHeight}
              deals={deals}
              onSelect={onSelect}
              onSelectDeal={onSelectDeal}
              stageTitles={stageTitles}
              stageColors={stageColors}
              renderRight={renderRight}
              showAccreditation={showAccreditation}
            />
          );
        })}

        <GanttLegendBar
          selectedStageIds={selectedStageIds}
          stageTitles={stageTitles}
          stageColors={stageColors}
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
  todayIndex,
  phases,
  rowHeight,
  deals,
  onSelect,
  onSelectDeal,
  stageTitles,
  stageColors,
  renderRight,
  showAccreditation,
}: {
  expo: ExpoItem;
  rowIndex: number;
  year: number;
  month: number;
  totalDays: number;
  todayIndex: number;
  phases: Phase[];
  rowHeight: number;
  deals?: BuildScheduleDeal[];
  onSelect: (expo: ExpoItem) => void;
  onSelectDeal?: (deal: BuildScheduleDeal) => void;
  stageTitles?: Map<string, string>;
  stageColors?: Map<string, string>;
  renderRight?: (expo: ExpoItem) => React.ReactNode;
  showAccreditation?: boolean;
}) {
  const dealList = deals ?? [];
  const dealRange = dealList.length > 0 ? expoOverallRange(expo) : undefined;
  const dealClip = dealRange ? clipToMonth(dealRange, year, month) : undefined;
  const accreditationGroups = showAccreditation ? accreditationDeadlineGroups(expo) : [];
  const deadlineRowsHeight = accreditationGroups.length ? 8 + accreditationGroups.length * 22 : 0;
  const accreditationTop = Math.max(0, rowHeight - deadlineRowsHeight);
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
        {accreditationGroups.length > 0 ? (
          <div className="mt-1 space-y-0.5 text-[11px] leading-tight text-muted-foreground">
            {accreditationGroups.map((group) => (
              <div key={group.key} className="flex items-center gap-1 truncate" title={group.label}>
                <AccreditationIcon group={group.key} />
                <span className="truncate">{group.label}</span>
              </div>
            ))}
          </div>
        ) : null}
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
          {todayIndex > 0 ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-[1] bg-primary/10"
              style={{
                left: `${((todayIndex - 1) / totalDays) * 100}%`,
                width: `${(1 / totalDays) * 100}%`,
              }}
              aria-hidden
            />
          ) : null}
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

        {accreditationGroups.flatMap((group, groupIndex) =>
          accreditationSegmentsForMonth(group, year, month).map((segment) => {
            const clip = clipToMonth({ start: segment.start, end: segment.end }, year, month);
            if (!clip) return null;
            const left = ((clip.startDay - 1) / totalDays) * 100;
            const width = ((clip.endDay - clip.startDay + 1) / totalDays) * 100;
            const meta = levelMeta(segment.level);
            const top = accreditationTop + 3 + groupIndex * 22;
            const labelAtEnd = segment.level === "base";
            const tooltip = segment.level === "base"
              ? `${group.label} · 0% до ${formatShort(segment.end)}`
              : `${group.label} · ${meta.label} с ${formatShort(segment.start)} по ${formatShort(segment.end)}`;
            return (
              <div
                key={`accreditation-${segment.key}`}
                className={`absolute z-[5] flex h-[17px] min-w-[2px] items-center border-y ${meta.className}`}
                style={{ left: `${left}%`, width: `${width}%`, top: `${top}px` }}
                title={tooltip}
                data-testid={`gantt-accreditation-${expo.id}-${segment.key}`}
              >
                {segment.level === "base" && clip.startDay === 1 ? (
                  <span className="ml-0.5 shrink-0 rounded bg-background/70 p-px" aria-label={group.label}>
                    <AccreditationIcon group={group.key} />
                  </span>
                ) : null}
                <span
                  className={`absolute rounded border px-0.5 py-px text-[8px] font-semibold leading-none shadow-sm ${meta.className} ${labelAtEnd ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"}`}
                >
                  {meta.label}
                </span>
              </div>
            );
          }),
        )}

        {accreditationGroups.map((group, groupIndex) => {
          const top = accreditationTop + 11 + groupIndex * 22;
          return (
            <div
              key={`accreditation-line-${group.key}`}
              className="pointer-events-none absolute z-[4] h-px bg-muted-foreground/25"
              style={{ left: "0%", right: "0%", top: `${top}px` }}
              aria-hidden
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
              const label = dealBarLabel(deal);
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
                    background: dealColor(deal, stageTitles, stageColors),
                  }}
                  title={summary}
                  data-testid={`gantt-deal-${deal.id}`}
                >
                  <span className="truncate">{label}</span>
                </button>
              );
            })
          : null}
      </div>
    </div>
  );
}

function AccreditationIcon({ group }: { group: AccreditationGroupKey }) {
  if (group === "singleStorey" || group === "doubleStorey") {
    return (
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground/45 text-[10px] font-semibold text-foreground">
        {group === "singleStorey" ? "1" : "2"}
      </span>
    );
  }
  if (group === "outdoor") {
    return (
      <svg className="h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 13.5h14M6 13.5a4 4 0 0 1 8 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="8" r="2.4" fill="currentColor" opacity=".85" />
        <path d="M10 3.5v1M5.8 5.3l.7.7M14.2 5.3l-.7.7M4.2 9h1M14.8 9h1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-600" viewBox="0 0 20 20" aria-hidden="true">
      {[3, 7, 11, 15].map((x) => <g key={x}><path d={`M${x} 3v7`} stroke="currentColor" strokeWidth="1.2" /><circle cx={x} cy="3" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" /><path d={`M${x - 1.2} 10h2.4`} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></g>)}
    </svg>
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
  stageColors,
}: {
  selectedStageIds?: string[];
  stageTitles?: Map<string, string>;
  stageColors?: Map<string, string>;
}) {
  const stageSwatches = (selectedStageIds ?? []).map((id) => {
    const color = stageDisplayColor(
      id,
      stageTitles?.get(id),
      stageColors?.get(id),
    );
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
