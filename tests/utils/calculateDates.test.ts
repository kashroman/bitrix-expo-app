import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateDates } from "../../server/utils/calculateDates.ts";

describe("calculateDates heuristic", () => {
  it("computes 3 working days back for a Tuesday begin", () => {
    // 2026-04-07 is a Tuesday → 3 working days back is 2026-04-02 (Thursday).
    const r = calculateDates("2026-04-07", "2026-04-09");
    assert.equal(r.montageStart, "2026-04-02");
    assert.equal(r.montageEnd, "2026-04-06");
    assert.equal(r.dismantleStart, "2026-04-10");
    assert.equal(r.dismantleEnd, "2026-04-11");
  });

  it("walks past the weekend when begin is Monday", () => {
    // 2026-04-06 is a Monday → 3 working days back = 2026-04-01 (Wednesday).
    const r = calculateDates("2026-04-06", "2026-04-08");
    assert.equal(r.montageStart, "2026-04-01");
    assert.equal(r.montageEnd, "2026-04-05");
  });

  it("handles missing inputs gracefully", () => {
    assert.deepEqual(calculateDates(undefined, undefined), {});
    const onlyBegin = calculateDates("2026-04-07", undefined);
    assert.equal(onlyBegin.montageStart, "2026-04-02");
    assert.equal(onlyBegin.dismantleStart, undefined);
  });

  it("dismantle end falls on weekend without correction (heuristic only)", () => {
    // 2026-04-03 (Friday) end → dismantleEnd = 2026-04-05 (Sunday). The
    // heuristic is intentionally simple — operators can adjust manually.
    const r = calculateDates("2026-04-01", "2026-04-03");
    assert.equal(r.dismantleStart, "2026-04-04");
    assert.equal(r.dismantleEnd, "2026-04-05");
  });
});
