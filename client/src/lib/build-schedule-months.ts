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
