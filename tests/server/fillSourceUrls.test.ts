/**
 * Service-level tests for the fillSourceUrls runner.
 *
 * The DDG fetch and Bitrix REST call are both injected, so these tests run
 * fully offline and never touch real CRM data. Focus areas:
 *  - dryRun=true is the default (omitted option)
 *  - apply path does NOT call crm.item.update unless allowlisted
 *  - existing source-url fields are never overwritten
 *  - aggregator domains are hard-skipped regardless of score
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runFillSourceUrls } from "../../server/lib/fillSourceUrls.ts";

type BxCall = { method: string; params: Record<string, any> };

function makeDeps(opts: {
  items: Record<string, any>[];
  ddgResults: { url: string; title: string; snippet: string }[];
}) {
  const calls: BxCall[] = [];
  const fakeBx = async <T = any>(
    method: string,
    params: Record<string, any> = {},
  ): Promise<T> => {
    calls.push({ method, params });
    if (method === "crm.item.list") {
      return { items: opts.items, next: undefined } as unknown as T;
    }
    if (method === "crm.item.update") {
      return { item: { id: params.id } } as unknown as T;
    }
    return {} as T;
  };
  const ddgSearch = async () => opts.ddgResults;
  const sleep = async () => {};
  const now = () => new Date("2026-05-12T10:00:00Z");
  return { fakeBx, ddgSearch, sleep, now, calls };
}

const futureExpoItem = {
  id: 101,
  title: "Металлообработка 2027",
  ufCrm8_1766066484758: "2027-05-25",
  ufCrm8_1766066501630: "2027-05-29",
  ufCrm8SourceUrl: "",
  ufCrm8ParseLog: "",
};

const allowlistedSearchHit = {
  url: "https://www.metobr-expo.ru/ru/",
  title: "Металлообработка — официальный сайт международной выставки",
  snippet:
    "Официальный сайт международной выставки Металлообработка 2027. metobr-expo.ru.",
};

describe("runFillSourceUrls — service", () => {
  it("defaults to dryRun=true when no option is passed", async () => {
    const { fakeBx, ddgSearch, sleep, now, calls } = makeDeps({
      items: [futureExpoItem],
      ddgResults: [allowlistedSearchHit],
    });
    const summary = await runFillSourceUrls(
      { todayIso: "2026-05-12", sleepMs: 0 },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(summary.mode, "dryRun");
    // Should only have called list, never update
    const updates = calls.filter((c) => c.method === "crm.item.update");
    assert.equal(updates.length, 0);
    // The candidate exists in results
    assert.equal(summary.results.length, 1);
    assert.equal(summary.results[0].status, "dryRun");
  });

  it("does NOT write to CRM in dryRun mode even with apply-eligible candidates", async () => {
    const { fakeBx, ddgSearch, sleep, now, calls } = makeDeps({
      items: [futureExpoItem],
      ddgResults: [allowlistedSearchHit],
    });
    await runFillSourceUrls(
      { dryRun: true, todayIso: "2026-05-12", sleepMs: 0 },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(
      calls.filter((c) => c.method === "crm.item.update").length,
      0,
    );
  });

  it("never overwrites an item that already has a source URL", async () => {
    const itemWithUrl = {
      ...futureExpoItem,
      ufCrm8SourceUrl: "https://existing.example/",
    };
    const { fakeBx, ddgSearch, sleep, now } = makeDeps({
      items: [itemWithUrl],
      ddgResults: [allowlistedSearchHit],
    });
    const summary = await runFillSourceUrls(
      { dryRun: false, todayIso: "2026-05-12", sleepMs: 0 },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    // futureEmpty filter excludes items with an existing URL → queue 0
    assert.equal(summary.futureEmpty, 0);
    assert.equal(summary.queue, 0);
    assert.equal(summary.updated, 0);
  });

  it("hard-skips aggregator domains regardless of score", async () => {
    const aggregatorHit = {
      url: "https://expomap.ru/exhibitions/metallurgy-2027",
      title: "Металлообработка 2027 — расписание выставок",
      snippet: "Каталог выставок expomap.ru — расписание, билеты.",
    };
    const { fakeBx, ddgSearch, sleep, now, calls } = makeDeps({
      items: [futureExpoItem],
      ddgResults: [aggregatorHit],
    });
    const summary = await runFillSourceUrls(
      { dryRun: false, todayIso: "2026-05-12", sleepMs: 0, allowUnlisted: true },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(summary.skippedAggregator, 1);
    assert.equal(summary.updated, 0);
    assert.equal(
      calls.filter((c) => c.method === "crm.item.update").length,
      0,
    );
  });

  it("apply mode refuses non-allowlisted domains even when score is high", async () => {
    const unknownHit = {
      url: "https://novelorganiserxyz.example/metalloobrabotka",
      title:
        "Металлообработка 2027 — официальный сайт международной выставки",
      snippet:
        "Официальный сайт международной выставки Металлообработка 2027.",
    };
    const { fakeBx, ddgSearch, sleep, now, calls } = makeDeps({
      items: [futureExpoItem],
      ddgResults: [unknownHit],
    });
    const summary = await runFillSourceUrls(
      { dryRun: false, todayIso: "2026-05-12", sleepMs: 0 },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(summary.updated, 0);
    assert.equal(
      calls.filter((c) => c.method === "crm.item.update").length,
      0,
    );
    // The candidate is either skippedNotAllowlisted or skippedLowConfidence —
    // both safe outcomes. The important invariant is no write happened.
    const r = summary.results[0];
    assert.ok(
      r.status === "skippedNotAllowlisted" || r.status === "skippedLowConfidence",
      `expected safe skip, got ${r.status}`,
    );
  });

  it("onlyIds filters the queue to the reviewed IDs (apply path)", async () => {
    const items = [
      { ...futureExpoItem, id: 1220 },
      { ...futureExpoItem, id: 1198 },
      { ...futureExpoItem, id: 1199, title: "Технофорум 2026" },
      { ...futureExpoItem, id: 1200, title: "СТО Экспо 2026" },
    ];
    const { fakeBx, ddgSearch, sleep, now, calls } = makeDeps({
      items,
      ddgResults: [allowlistedSearchHit],
    });
    const summary = await runFillSourceUrls(
      {
        dryRun: false,
        todayIso: "2026-05-12",
        sleepMs: 0,
        onlyIds: [1220, 1198],
      },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(summary.futureEmpty, 4);
    assert.equal(summary.queue, 2);
    assert.equal(summary.skippedNotSelected, 2);
    // Only the two selected IDs reach the per-item processing path.
    const processedIds = summary.results.map((r) => r.itemId).sort();
    assert.deepEqual(processedIds, [1198, 1220]);
    // Update calls must be limited to selected IDs.
    const updateIds = calls
      .filter((c) => c.method === "crm.item.update")
      .map((c) => Number(c.params.id))
      .sort();
    assert.deepEqual(updateIds, [1198, 1220]);
  });

  it("onlyIds in dry-run still excludes non-selected items from results", async () => {
    const items = [
      { ...futureExpoItem, id: 1220 },
      { ...futureExpoItem, id: 1199, title: "Технофорум 2026" },
    ];
    const { fakeBx, ddgSearch, sleep, now, calls } = makeDeps({
      items,
      ddgResults: [allowlistedSearchHit],
    });
    const summary = await runFillSourceUrls(
      { dryRun: true, todayIso: "2026-05-12", sleepMs: 0, onlyIds: [1220] },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(summary.skippedNotSelected, 1);
    assert.equal(summary.results.length, 1);
    assert.equal(summary.results[0].itemId, 1220);
    assert.equal(
      calls.filter((c) => c.method === "crm.item.update").length,
      0,
    );
  });

  it("limit clamps the queue size", async () => {
    const items = Array.from({ length: 5 }).map((_, i) => ({
      ...futureExpoItem,
      id: 100 + i,
      title: `${futureExpoItem.title} #${i}`,
    }));
    const { fakeBx, ddgSearch, sleep, now } = makeDeps({
      items,
      ddgResults: [],
    });
    const summary = await runFillSourceUrls(
      { dryRun: true, limit: 2, todayIso: "2026-05-12", sleepMs: 0 },
      { bx: fakeBx, ddgSearch, sleep, now },
    );
    assert.equal(summary.futureEmpty, 5);
    assert.equal(summary.queue, 2);
    assert.equal(summary.results.length, 2);
  });
});
