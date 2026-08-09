import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findStaleHandlers,
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

  it("retires the duplicate LEFT_MENU handler even on the current origin", () => {
    const stale = findStaleHandlers(
      [
        {
          placement: "LEFT_MENU",
          handler: `${currentOrigin}/calendar`,
        },
      ],
      getManagedPlacements(1050),
      currentOrigin,
    );
    assert.equal(stale.length, 1);
  });

  it("keeps the current CRM analytics calendar handler", () => {
    const stale = findStaleHandlers(
      [
        {
          placement: "CRM_ANALYTICS_MENU",
          handler: `${currentOrigin}/calendar`,
        },
      ],
      getManagedPlacements(1050),
      currentOrigin,
    );
    assert.equal(stale.length, 0);
  });
});
