import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDealStats,
  formatBitrixUserName,
} from "../../client/src/lib/expo-data.ts";

describe("exhibition KPI deal semantics", () => {
  it("counts the pinned Строим stage 9 as won", () => {
    const stats = computeDealStats([
      { ID: 1, STAGE_ID: "9" },
      { ID: 2, STAGE_ID: "WON" },
      { ID: 3, STAGE_ID: "8" },
    ]);

    assert.equal(stats.won, 2);
    assert.deepEqual(
      stats.byGroup.won.map((deal) => deal.ID),
      [1, 2],
    );
  });
});

describe("Bitrix user labels", () => {
  it("formats manager names as surname, name, patronymic", () => {
    assert.equal(
      formatBitrixUserName({
        NAME: "Иван",
        LAST_NAME: "Иванов",
        SECOND_NAME: "Иванович",
      }),
      "Иванов Иван Иванович",
    );
  });
});
