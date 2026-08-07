import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultStageIdsFromThreshold,
  filterDealsByManagers,
  isLostStage,
  lostStageIdsForThreshold,
  readCalendarFilters,
  writeCalendarFilters,
} from "../../client/src/lib/calendar-filters.ts";
import type {
  BuildScheduleResult,
  StatusRef,
} from "../../client/src/lib/expo-data.ts";

const stages: StatusRef[] = [
  { id: "NEW", title: "Новая", categoryId: "0", sort: 10, semantic: "P" },
  {
    id: "DESIGN",
    title: "Разработка и согласование дизайн-проекта",
    categoryId: "0",
    sort: 20,
    semantic: "P",
  },
  { id: "BUILD", title: "Строим", categoryId: "0", sort: 30, semantic: "P" },
  { id: "WON", title: "Проект завершён", categoryId: "0", sort: 40, semantic: "S" },
  { id: "LOSE", title: "Проиграна", categoryId: "0", sort: 50, semantic: "F" },
];

describe("calendar filter URL state", () => {
  it("defaults to current month, deals-only and no lost deals", () => {
    const state = readCalendarFilters("", new Date(2026, 7, 7));
    assert.equal(state.monthKey, "2026-08");
    assert.equal(state.onlyWithDeals, true);
    assert.equal(state.includeLost, false);
    assert.equal(state.hasExplicitStages, false);
  });

  it("round-trips filters without dropping unrelated Bitrix parameters", () => {
    const search = writeCalendarFilters("?DOMAIN=portal.bitrix24.ru", {
      monthKey: "2026-09",
      stageIds: ["DESIGN", "BUILD"],
      managerIds: ["7", "9"],
      onlyWithDeals: false,
      includeLost: true,
    });
    const params = new URLSearchParams(search);
    assert.equal(params.get("DOMAIN"), "portal.bitrix24.ru");
    const parsed = readCalendarFilters(search);
    assert.deepEqual(parsed.stageIds, ["DESIGN", "BUILD"]);
    assert.deepEqual(parsed.managerIds, ["7", "9"]);
    assert.equal(parsed.onlyWithDeals, false);
    assert.equal(parsed.includeLost, true);
  });
});

describe("default deal stages", () => {
  it("selects the threshold and every later non-lost stage", () => {
    assert.deepEqual(defaultStageIdsFromThreshold(stages), [
      "DESIGN",
      "BUILD",
      "WON",
    ]);
  });

  it("keeps lost stages in the separate optional set", () => {
    assert.deepEqual(lostStageIdsForThreshold(stages), ["LOSE"]);
    assert.equal(isLostStage(stages.at(-1)!), true);
  });

  it("does not guess when the configured threshold is missing", () => {
    assert.deepEqual(defaultStageIdsFromThreshold(stages, "Несуществующая"), []);
  });
});

describe("manager filtering", () => {
  it("filters deals and rebuilds expo buckets", () => {
    const result: BuildScheduleResult = {
      deals: [
        { id: 1, expoIds: [100], title: "A", stageId: "BUILD", stageTail: "BUILD", assignedById: "7", raw: {} },
        { id: 2, expoIds: [100, 200], title: "B", stageId: "WON", stageTail: "WON", assignedById: "9", raw: {} },
      ],
      byExpoId: new Map([
        [100, []],
        [200, []],
      ]),
      diagnostics: {
        expoIdsRequested: 2,
        stageIds: ["BUILD", "WON"],
        dealField: "UF_TEST",
        dealChunks: 1,
        dealRequests: 1,
        dealRowsLoaded: 2,
        dealRowsKept: 2,
        dealFailures: [],
        durationMs: 1,
        truncated: false,
        deadlineReached: false,
      },
    };
    const filtered = filterDealsByManagers(result, ["9"]);
    assert.deepEqual(filtered?.deals.map((deal) => deal.id), [2]);
    assert.deepEqual(filtered?.byExpoId.get(100)?.map((deal) => deal.id), [2]);
    assert.deepEqual(filtered?.byExpoId.get(200)?.map((deal) => deal.id), [2]);
  });
});
