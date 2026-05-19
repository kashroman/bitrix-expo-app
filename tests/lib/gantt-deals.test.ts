import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dealRowHeight,
  expoOverallRange,
  stageFallbackColor,
} from "../../client/src/components/gantt.tsx";
import type { ExpoItem } from "../../client/src/lib/expo-data.ts";

function expoWithDates(
  installStart: string,
  installEnd: string,
  expoStart: string,
  expoEnd: string,
  dismantleStart: string,
  dismantleEnd: string,
): ExpoItem {
  return {
    id: 1,
    title: "Expo #1",
    installStart,
    installEnd,
    expoStart,
    expoEnd,
    dismantleStart,
    dismantleEnd,
    raw: {} as ExpoItem["raw"],
  } as ExpoItem;
}

describe("dealRowHeight", () => {
  it("returns the base height when there are no deals", () => {
    assert.equal(dealRowHeight(0, 56), 56);
  });

  it("grows with each additional deal bar once the stack outgrows the base", () => {
    const base = 56;
    const five = dealRowHeight(5, base);
    const ten = dealRowHeight(10, base);
    assert.ok(five > base, "five deals taller than the base row");
    assert.ok(ten > five, "ten deals taller than five deals");
  });

  it("never returns less than the base height", () => {
    assert.ok(dealRowHeight(1, 200) >= 200);
  });
});

describe("expoOverallRange", () => {
  it("spans from earliest install/expo start to latest dismantle/expo end", () => {
    const expo = expoWithDates(
      "2026-03-10",
      "2026-03-12",
      "2026-03-13",
      "2026-03-15",
      "2026-03-16",
      "2026-03-18",
    );
    const range = expoOverallRange(expo)!;
    assert.equal(range.start.getMonth(), 2);
    assert.equal(range.start.getDate(), 10);
    assert.equal(range.end.getMonth(), 2);
    assert.equal(range.end.getDate(), 18);
  });

  it("returns undefined when no date fields are set", () => {
    const expo = { id: 2, title: "x", raw: {} as ExpoItem["raw"] } as ExpoItem;
    assert.equal(expoOverallRange(expo), undefined);
  });
});

describe("stageFallbackColor", () => {
  it("returns a deterministic color for the same stage id", () => {
    assert.equal(stageFallbackColor("NEW"), stageFallbackColor("NEW"));
  });

  it("returns different colors for visibly different stage ids", () => {
    const a = stageFallbackColor("ASSIGN_DESIGNER");
    const b = stageFallbackColor("NEW");
    // The palette is small (10 entries), so collisions are possible — but
    // these two distinct ids should not collide.
    assert.notEqual(a, b);
  });

  it("falls back to neutral for empty input", () => {
    assert.equal(stageFallbackColor(""), "#94a3b8");
    assert.equal(stageFallbackColor(null), "#94a3b8");
  });
});
