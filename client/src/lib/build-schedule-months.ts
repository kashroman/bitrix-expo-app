export const MONTH_NAMES_RU_SHORT = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
] as const;

export type MonthSegment = {
  index: number;
  name: string;
  leftPct: number;
  widthPct: number;
};

export function daysInYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

export function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// Compute each month's start (leftPct) and width (widthPct) as percentages of
// the year, using real day counts so bars stay aligned with date positions.
export function monthSegments(year: number): MonthSegment[] {
  const total = daysInYear(year);
  const segments: MonthSegment[] = [];
  let dayCursor = 0;
  for (let m = 0; m < 12; m++) {
    const days = daysInMonth(year, m);
    segments.push({
      index: m,
      name: MONTH_NAMES_RU_SHORT[m],
      leftPct: (dayCursor / total) * 100,
      widthPct: (days / total) * 100,
    });
    dayCursor += days;
  }
  return segments;
}

export type MonthBounds = {
  year: number;
  monthIdx: number;
  startMs: number;
  endMs: number; // inclusive (last day at 00:00 local)
  days: number;
};

export function monthBounds(year: number, monthIdx: number): MonthBounds {
  const days = daysInMonth(year, monthIdx);
  const start = new Date(year, monthIdx, 1).getTime();
  const end = new Date(year, monthIdx, days).getTime();
  return { year, monthIdx, startMs: start, endMs: end, days };
}

// Clip a [startMs, endMs] inclusive range to the given month and return the
// visible left/width as percentages of the month width, or undefined if the
// range does not intersect the month.
export function clipToMonth(
  rangeStartMs: number,
  rangeEndMs: number,
  bounds: MonthBounds,
): { leftPct: number; widthPct: number } | undefined {
  const monthStart = bounds.startMs;
  const monthEnd = bounds.endMs;
  if (rangeEndMs < monthStart || rangeStartMs > monthEnd) return undefined;
  const clippedStart = Math.max(rangeStartMs, monthStart);
  const clippedEnd = Math.min(rangeEndMs, monthEnd);
  const startDayIdx = Math.round((clippedStart - monthStart) / 86_400_000);
  const endDayIdx = Math.round((clippedEnd - monthStart) / 86_400_000);
  const total = bounds.days;
  const leftPct = (startDayIdx / total) * 100;
  const widthPct = Math.max(0.3, ((endDayIdx - startDayIdx + 1) / total) * 100);
  return { leftPct, widthPct };
}

// Position (0..100) of a date within the month, or undefined if not in month.
export function percentWithinMonth(
  ms: number,
  bounds: MonthBounds,
): number | undefined {
  if (ms < bounds.startMs || ms > bounds.endMs) return undefined;
  const dayIdx = Math.round((ms - bounds.startMs) / 86_400_000);
  return (dayIdx / bounds.days) * 100;
}
