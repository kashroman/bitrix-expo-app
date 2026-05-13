import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_SCHEDULE_STAGE_IDS,
  matchBuildScheduleStage,
} from "../../client/src/lib/config.ts";
import {
  filterExposWithBuildScheduleDeals,
  isBuildScheduleStage,
  type BuildScheduleDeal,
  type ExpoItem,
} from "../../client/src/lib/expo-data.ts";

function makeExpo(id: number, title = `Expo #${id}`): ExpoItem {
  return {
    id,
    title,
    raw: { id } as unknown as ExpoItem["raw"],
  };
}

function makeDeal(id: number, expoIds: number[], stageId: string): BuildScheduleDeal {
  return {
    id,
    title: `Deal ${id}`,
    stageId,
    stageTail: stageId.split(":").pop() ?? stageId,
    expoIds,
  } as BuildScheduleDeal;
}

describe("BUILD_SCHEDULE_STAGE_IDS default", () => {
  it("defaults to 8, 9, WON when no env override is provided", () => {
    assert.deepEqual(BUILD_SCHEDULE_STAGE_IDS, ["8", "9", "WON"]);
  });
});

describe("isBuildScheduleStage", () => {
  it("matches plain pinned IDs", () => {
    assert.equal(isBuildScheduleStage("8"), true);
    assert.equal(isBuildScheduleStage("9"), true);
    assert.equal(isBuildScheduleStage("WON"), true);
  });

  it("matches the prefixed (category) form by trailing tail", () => {
    assert.equal(isBuildScheduleStage("C1:8"), true);
    assert.equal(isBuildScheduleStage("C2:WON"), true);
  });

  it("rejects stages outside the whitelist", () => {
    assert.equal(isBuildScheduleStage("NEW"), false);
    assert.equal(isBuildScheduleStage("PREPARATION"), false);
    assert.equal(isBuildScheduleStage("C1:LOSE"), false);
  });

  it("rejects empty / nullish input", () => {
    assert.equal(isBuildScheduleStage(undefined), false);
    assert.equal(isBuildScheduleStage(null), false);
    assert.equal(isBuildScheduleStage(""), false);
    assert.equal(isBuildScheduleStage("   "), false);
  });

  it("honours an explicit whitelist override", () => {
    assert.equal(isBuildScheduleStage("FOO", ["FOO", "BAR"]), true);
    assert.equal(isBuildScheduleStage("WON", ["FOO", "BAR"]), false);
  });
});

describe("matchBuildScheduleStage", () => {
  it("returns the pinned ID when matched (exact or via tail)", () => {
    assert.equal(matchBuildScheduleStage("8"), "8");
    assert.equal(matchBuildScheduleStage("C1:8"), "8");
    assert.equal(matchBuildScheduleStage("WON"), "WON");
    assert.equal(matchBuildScheduleStage("C2:WON"), "WON");
  });

  it("returns undefined for non-matching stages", () => {
    assert.equal(matchBuildScheduleStage("NEW"), undefined);
    assert.equal(matchBuildScheduleStage("C1:LOSE"), undefined);
    assert.equal(matchBuildScheduleStage(undefined), undefined);
    assert.equal(matchBuildScheduleStage(null), undefined);
    assert.equal(matchBuildScheduleStage(""), undefined);
  });
});

describe("filterExposWithBuildScheduleDeals", () => {
  it("returns an empty array when the deals map is undefined", () => {
    const expos = [makeExpo(1), makeExpo(2)];
    assert.deepEqual(filterExposWithBuildScheduleDeals(expos, undefined), []);
  });

  it("keeps only expos that have at least one deal in the map", () => {
    const expos = [makeExpo(1), makeExpo(2), makeExpo(3)];
    const map = new Map<number, BuildScheduleDeal[]>();
    map.set(1, [makeDeal(1001, [1], "8")]);
    map.set(2, []); // empty entry should not qualify
    // expo 3 has no entry at all
    const result = filterExposWithBuildScheduleDeals(expos, map);
    assert.deepEqual(
      result.map((e) => e.id),
      [1],
    );
  });

  it("preserves the original order of the input expos", () => {
    const expos = [makeExpo(10), makeExpo(20), makeExpo(30)];
    const map = new Map<number, BuildScheduleDeal[]>();
    map.set(30, [makeDeal(3001, [30], "WON")]);
    map.set(10, [makeDeal(1001, [10], "9")]);
    const result = filterExposWithBuildScheduleDeals(expos, map);
    assert.deepEqual(
      result.map((e) => e.id),
      [10, 30],
    );
  });
});
