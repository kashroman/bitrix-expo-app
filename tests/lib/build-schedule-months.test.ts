import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MONTH_NAMES_RU_SHORT,
  clipToMonth,
  daysInMonth,
  daysInYear,
  monthBounds,
  monthSegments,
  percentWithinMonth,
} from "../../client/src/lib/build-schedule-months.ts";

describe("daysInYear", () => {
  it("returns 365 for a common year", () => {
    assert.equal(daysInYear(2025), 365);
    assert.equal(daysInYear(2026), 365);
  });

  it("returns 366 for a leap year", () => {
    assert.equal(daysInYear(2024), 366);
    assert.equal(daysInYear(2000), 366);
  });

  it("treats century non-leap years correctly", () => {
    assert.equal(daysInYear(1900), 365);
    assert.equal(daysInYear(2100), 365);
  });
});

describe("daysInMonth", () => {
  it("returns correct lengths for a common year", () => {
    const lengths = Array.from({ length: 12 }, (_, m) => daysInMonth(2025, m));
    assert.deepEqual(lengths, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it("returns 29 for February in a leap year", () => {
    assert.equal(daysInMonth(2024, 1), 29);
  });
});

describe("monthSegments", () => {
  it("returns 12 segments using short Russian month labels", () => {
    const segments = monthSegments(2026);
    assert.equal(segments.length, 12);
    assert.deepEqual(
      segments.map((s) => s.name),
      [...MONTH_NAMES_RU_SHORT],
    );
    assert.deepEqual(
      segments.map((s) => s.index),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    );
  });

  it("starts at 0% and ends covering the full year", () => {
    const segments = monthSegments(2025);
    assert.equal(segments[0].leftPct, 0);
    const last = segments[11];
    const end = last.leftPct + last.widthPct;
    assert.ok(Math.abs(end - 100) < 1e-9, `expected ~100, got ${end}`);
  });

  it("uses real month widths (Feb < Jan, Feb is wider in a leap year)", () => {
    const common = monthSegments(2025);
    const leap = monthSegments(2024);
    assert.ok(common[1].widthPct < common[0].widthPct);
    assert.ok(leap[1].widthPct > common[1].widthPct);
  });

  it("widths sum to exactly 100%", () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const sum = monthSegments(year).reduce((acc, s) => acc + s.widthPct, 0);
      assert.ok(Math.abs(sum - 100) < 1e-9, `year ${year} sum=${sum}`);
    }
  });

  it("each segment's leftPct equals the previous left+width (no gaps)", () => {
    const segments = monthSegments(2026);
    for (let i = 1; i < segments.length; i++) {
      const expected = segments[i - 1].leftPct + segments[i - 1].widthPct;
      assert.ok(
        Math.abs(segments[i].leftPct - expected) < 1e-9,
        `gap at month ${i}: ${segments[i].leftPct} vs ${expected}`,
      );
    }
  });
});

describe("monthBounds", () => {
  it("returns inclusive day range for the month", () => {
    const b = monthBounds(2026, 0); // January
    assert.equal(new Date(b.startMs).getDate(), 1);
    assert.equal(new Date(b.endMs).getDate(), 31);
    assert.equal(b.days, 31);
  });

  it("handles leap February", () => {
    const b = monthBounds(2024, 1);
    assert.equal(b.days, 29);
    assert.equal(new Date(b.endMs).getDate(), 29);
  });
});

describe("clipToMonth", () => {
  const jan = monthBounds(2026, 0); // 31 days
  const feb = monthBounds(2026, 1); // 28 days

  function ms(y: number, m: number, d: number): number {
    return new Date(y, m, d).getTime();
  }

  it("returns full width when range covers entire month", () => {
    const clip = clipToMonth(ms(2026, 0, 1), ms(2026, 0, 31), jan);
    assert.ok(clip);
    assert.equal(clip!.leftPct, 0);
    assert.ok(Math.abs(clip!.widthPct - 100) < 1e-9);
  });

  it("returns undefined when range is entirely before the month", () => {
    const clip = clipToMonth(ms(2025, 11, 1), ms(2025, 11, 31), jan);
    assert.equal(clip, undefined);
  });

  it("returns undefined when range is entirely after the month", () => {
    const clip = clipToMonth(ms(2026, 1, 1), ms(2026, 1, 28), jan);
    assert.equal(clip, undefined);
  });

  it("clips the start when range begins before the month", () => {
    // Dec 25 → Jan 10: visible portion is Jan 1..Jan 10 (10 days / 31)
    const clip = clipToMonth(ms(2025, 11, 25), ms(2026, 0, 10), jan);
    assert.ok(clip);
    assert.equal(clip!.leftPct, 0);
    assert.ok(Math.abs(clip!.widthPct - (10 / 31) * 100) < 1e-6);
  });

  it("clips the end when range extends past the month", () => {
    // Jan 20 → Feb 5: visible portion in Jan is Jan 20..Jan 31 (12 days / 31)
    const clip = clipToMonth(ms(2026, 0, 20), ms(2026, 1, 5), jan);
    assert.ok(clip);
    assert.ok(Math.abs(clip!.leftPct - (19 / 31) * 100) < 1e-6);
    assert.ok(Math.abs(clip!.widthPct - (12 / 31) * 100) < 1e-6);
  });

  it("positions a single-day range correctly", () => {
    const clip = clipToMonth(ms(2026, 1, 14), ms(2026, 1, 14), feb);
    assert.ok(clip);
    assert.ok(Math.abs(clip!.leftPct - (13 / 28) * 100) < 1e-6);
    // Width snaps to >= 0.3 floor
    assert.ok(clip!.widthPct >= (1 / 28) * 100 - 1e-6);
  });
});

describe("percentWithinMonth", () => {
  const jan = monthBounds(2026, 0);

  it("returns 0% for the first day", () => {
    const pct = percentWithinMonth(new Date(2026, 0, 1).getTime(), jan);
    assert.equal(pct, 0);
  });

  it("returns roughly N/days*100 for day N", () => {
    const pct = percentWithinMonth(new Date(2026, 0, 16).getTime(), jan);
    assert.ok(pct !== undefined);
    assert.ok(Math.abs(pct! - (15 / 31) * 100) < 1e-6);
  });

  it("returns undefined for a date outside the month", () => {
    const pct = percentWithinMonth(new Date(2026, 1, 5).getTime(), jan);
    assert.equal(pct, undefined);
  });
});
