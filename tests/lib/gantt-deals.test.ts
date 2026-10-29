import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accreditationDeadlineGroups,
  accreditationDeadlines,
  accreditationSegmentsForMonth,
  dealBarLabel,
  dealRowHeight,
  expoOverallRange,
  sortDealsByStage,
  stageFallbackColor,
} from "../../client/src/components/gantt.tsx";
import type { BuildScheduleDeal, ExpoItem } from "../../client/src/lib/expo-data.ts";
import { stageDisplayColor } from "../../client/src/lib/stage-colors.ts";

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

describe("stageDisplayColor", () => {
  it("prefers the native Bitrix24 stage color", () => {
    assert.equal(stageDisplayColor("9", "Строим", "#7052D3"), "#7052D3");
  });
});

describe("Gantt deal labels and order", () => {
  const deal = (id: number, stageId: string, clientName?: string): BuildScheduleDeal => ({
    id,
    expoIds: [1],
    title: `Сделка ${id}`,
    stageId,
    stageTail: stageId,
    status: undefined,
    clientName,
    raw: {},
  });

  it("uses the client name on a deal bar", () => {
    assert.equal(dealBarLabel(deal(1, "BUILD", "ООО Клиент")), "ООО Клиент");
    assert.equal(dealBarLabel(deal(1, "BUILD")), "Сделка 1");
  });

  it("orders deal bars by the funnel stage", () => {
    const stageSorts = new Map([
      ["FIRST", 10],
      ["BUILD", 20],
      ["WON", 30],
    ]);
    assert.deepEqual(
      sortDealsByStage([
        deal(3, "WON"),
        deal(2, "BUILD"),
        deal(1, "FIRST"),
      ], stageSorts).map((item) => item.id),
      [1, 2, 3],
    );
  });
});

describe("accreditation deadlines", () => {
  it("groups only completed deadlines by construction type and coefficient", () => {
    const expo = {
      id: 1,
      title: "Expo #1",
      accreditation: {
        singleStorey: { base: "2026-05-01", fifty: "2026-05-15" },
        outdoor: { hundred: "2026-05-20" },
        suspension: {},
      },
      raw: {},
    } as ExpoItem;

    assert.deepEqual(
      accreditationDeadlineGroups(expo).map((group) => ({
        key: group.key,
        dates: group.deadlines.map((deadline) => ({
          key: deadline.key,
          label: deadline.label,
          date: deadline.date.toISOString().slice(0, 10),
        })),
      })),
      [
        {
          key: "singleStorey",
          dates: [
            { key: "singleStorey-base", label: "0%", date: "2026-05-01" },
            { key: "singleStorey-fifty", label: "+50%", date: "2026-05-15" },
          ],
        },
        {
          key: "outdoor",
          dates: [
            { key: "outdoor-hundred", label: "+100%", date: "2026-05-20" },
          ],
        },
      ],
    );
    assert.equal(accreditationDeadlines(expo).length, 3);
  });

  it("draws 0% from the left edge for the deadline month and its predecessor", () => {
    const expo = {
      id: 1,
      title: "Expo #1",
      accreditation: {
        singleStorey: {
          base: "2026-11-05",
          fifty: "2026-11-12",
          hundred: "2026-11-19",
        },
      },
      raw: {},
    } as ExpoItem;
    const group = accreditationDeadlineGroups(expo)[0];

    assert.deepEqual(
      accreditationSegmentsForMonth(group, 2026, 9).map((segment) => [
        segment.level,
        segment.start.getDate(),
        segment.end.getDate(),
      ]),
      [["base", 1, 5]],
    );
    assert.deepEqual(
      accreditationSegmentsForMonth(group, 2026, 8),
      [],
    );
  });

  it("starts each surcharge on the day after the previous deadline", () => {
    const expo = {
      id: 1,
      title: "Expo #1",
      accreditation: {
        singleStorey: {
          base: "2026-10-21",
          fifty: "2026-11-12",
          hundred: "2026-11-20",
        },
      },
      raw: {},
    } as ExpoItem;
    const group = accreditationDeadlineGroups(expo)[0];
    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    assert.deepEqual(
      accreditationSegmentsForMonth(group, 2026, 10).map((segment) => ({
        level: segment.level,
        start: dateKey(segment.start),
        end: dateKey(segment.end),
      })),
      [
        { level: "fifty", start: "2026-10-22", end: "2026-11-12" },
        { level: "hundred", start: "2026-11-13", end: "2026-11-20" },
      ],
    );
  });
});
