import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getManagedPlacements,
  isStaleHandler,
} from "../../client/src/lib/bitrix.ts";

const currentOrigin = "https://app.containers.yandexcloud.net";

describe("Bitrix placement cleanup", () => {
  it("keeps an active handler on the current origin", () => {
    assert.equal(
      isStaleHandler(`${currentOrigin}/calendar`, currentOrigin),
      false,
    );
  });

  it("marks an active handler on another origin as stale", () => {
    assert.equal(
      isStaleHandler("https://old.example/calendar", currentOrigin),
      true,
    );
  });

  it("marks retired routes as stale even on the current origin", () => {
    for (const route of [
      "/placement-detail",
      "/placement-list",
      "/placement-menu",
    ]) {
      assert.equal(isStaleHandler(`${currentOrigin}${route}`, currentOrigin), true);
    }
  });

  it("includes the retired dynamic list placement for cleanup only", () => {
    assert.ok(getManagedPlacements(1050).includes("CRM_DYNAMIC_1050_LIST_MENU"));
  });
});
