import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clipToMonth } from "../../client/src/components/build-schedule.tsx";

function d(y: number, m: number, day: number): Date {
  return new Date(y, m, day);
}

describe("build-schedule clipToMonth", () => {
  it("returns full month when range spans entire month", () => {
    const clip = clipToMonth(
      { start: d(2026, 0, 1), end: d(2026, 0, 31) },
      2026,
      0,
    );
    assert.deepEqual(clip, { startDay: 1, endDay: 31 });
  });

  it("returns undefined for ranges entirely before the month", () => {
    const clip = clipToMonth(
      { start: d(2025, 11, 1), end: d(2025, 11, 31) },
      2026,
      0,
    );
    assert.equal(clip, undefined);
  });

  it("returns undefined for ranges entirely after the month", () => {
    const clip = clipToMonth(
      { start: d(2026, 1, 1), end: d(2026, 1, 15) },
      2026,
      0,
    );
    assert.equal(clip, undefined);
  });

  it("clips the start when range begins before the month", () => {
    const clip = clipToMonth(
      { start: d(2025, 11, 25), end: d(2026, 0, 10) },
      2026,
      0,
    );
    assert.deepEqual(clip, { startDay: 1, endDay: 10 });
  });

  it("clips the end when range extends past the month", () => {
    const clip = clipToMonth(
      { start: d(2026, 0, 20), end: d(2026, 1, 5) },
      2026,
      0,
    );
    assert.deepEqual(clip, { startDay: 20, endDay: 31 });
  });

  it("handles single-day ranges within the month", () => {
    const clip = clipToMonth(
      { start: d(2026, 1, 14), end: d(2026, 1, 14) },
      2026,
      1,
    );
    assert.deepEqual(clip, { startDay: 14, endDay: 14 });
  });

  it("handles leap-February", () => {
    const clip = clipToMonth(
      { start: d(2024, 1, 1), end: d(2024, 1, 29) },
      2024,
      1,
    );
    assert.deepEqual(clip, { startDay: 1, endDay: 29 });
  });
});
