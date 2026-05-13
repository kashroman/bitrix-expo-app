import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MONTH_NAMES_RU_SHORT,
  daysInMonth,
  daysInYear,
  monthSegments,
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
