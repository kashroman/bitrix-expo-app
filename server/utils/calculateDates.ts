/**
 * Heuristic montage/dismantle date calculation.
 *
 * Inputs are ISO `YYYY-MM-DD` strings (the same format the parsers and the
 * Bitrix smart-process date fields use). All math is done in UTC to avoid
 * timezone drift on Render (Etc/UTC) when the call originates from a request.
 *
 * Rules (no organizer schedule available):
 *   montageStart    = beginDate − 3 working days
 *   montageEnd      = beginDate − 1 day
 *   dismantleStart  = endDate   + 1 day
 *   dismantleEnd    = endDate   + 2 days
 *
 * "Working day" is Mon–Fri. If `beginDate` lands on a Monday, montageStart
 * walks back through the weekend so the operator gets a Wednesday instead
 * of an empty weekend slot.
 */

export type CalculatedDates = {
  montageStart?: string;
  montageEnd?: string;
  dismantleStart?: string;
  dismantleEnd?: string;
};

export function calculateDates(beginIso?: string, endIso?: string): CalculatedDates {
  const out: CalculatedDates = {};
  if (beginIso) {
    const begin = parseIso(beginIso);
    if (begin) {
      out.montageStart = formatIso(subtractWorkingDays(begin, 3));
      out.montageEnd = formatIso(addDays(begin, -1));
    }
  }
  if (endIso) {
    const end = parseIso(endIso);
    if (end) {
      out.dismantleStart = formatIso(addDays(end, 1));
      out.dismantleEnd = formatIso(addDays(end, 2));
    }
  }
  return out;
}

function parseIso(iso: string): Date | undefined {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function subtractWorkingDays(d: Date, days: number): Date {
  let cur = new Date(d.getTime());
  let remaining = days;
  while (remaining > 0) {
    cur = addDays(cur, -1);
    const dow = cur.getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return cur;
}
