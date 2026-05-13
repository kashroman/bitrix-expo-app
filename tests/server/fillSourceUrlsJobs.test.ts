/**
 * Tests for the in-memory FillSourceUrlsJobStore.
 *
 * The store wraps runFillSourceUrls — these tests inject a fake runner so we
 * verify the orchestration (status transitions, progress capture, cancel,
 * default dryRun, TTL gc, ID privacy) without touching DDG or Bitrix REST.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FillSourceUrlsJobStore } from "../../server/lib/fillSourceUrlsJobs.ts";
import type {
  FillSourceUrlsProgress,
  FillSourceUrlsSummary,
} from "../../server/lib/fillSourceUrls.ts";
import { FillSourceUrlsAbortError } from "../../server/lib/fillSourceUrls.ts";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function tick() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function fakeSummary(mode: "dryRun" | "apply"): FillSourceUrlsSummary {
  return {
    mode,
    todayIso: "2026-05-12",
    minConfidence: 0.85,
    limit: 0,
    allowUnlisted: false,
    scanned: 1,
    future: 1,
    futureEmpty: 1,
    queue: 1,
    found: 1,
    updated: mode === "apply" ? 1 : 0,
    skippedLowConfidence: 0,
    skippedAggregator: 0,
    skippedNotAllowlisted: 0,
    skippedNoResults: 0,
    errors: 0,
    dryRunApplyEligible: mode === "dryRun" ? 1 : 0,
    dryRunNotAllowlisted: 0,
    allowlistEntries: 10,
    results: [],
  };
}

describe("FillSourceUrlsJobStore", () => {
  it("defaults to dryRun mode when dryRun option is omitted", async () => {
    const gate = deferred<void>();
    let capturedDryRun: boolean | undefined;
    const fakeRunner = (async (opts: any) => {
      capturedDryRun = opts.dryRun;
      await gate.promise;
      return fakeSummary("dryRun");
    }) as any;
    const store = new FillSourceUrlsJobStore({ runner: fakeRunner });
    const job = store.start({});
    assert.equal(job.mode, "dryRun");
    assert.equal(job.status, "running");
    gate.resolve();
    await tick();
    const final = store.get(job.jobId);
    assert.ok(final);
    assert.equal(final!.status, "done");
    assert.equal(capturedDryRun, true);
  });

  it("explicit dryRun=false yields apply mode and reaches done", async () => {
    const fakeRunner = (async () => fakeSummary("apply")) as any;
    const store = new FillSourceUrlsJobStore({ runner: fakeRunner });
    const job = store.start({ dryRun: false });
    assert.equal(job.mode, "apply");
    await tick();
    const final = store.get(job.jobId)!;
    assert.equal(final.status, "done");
    assert.equal(final.summary?.mode, "apply");
  });

  it("captures progress events into job.progress without exposing internals", async () => {
    const fakeRunner = (async (opts: any) => {
      opts.onProgress?.({
        phase: "scanning",
        scanned: 5,
        future: 4,
        futureEmpty: 3,
        queue: 2,
        processed: 0,
        results: [],
      } satisfies FillSourceUrlsProgress);
      opts.onProgress?.({
        phase: "processing",
        scanned: 5,
        future: 4,
        futureEmpty: 3,
        queue: 2,
        processed: 1,
        results: [
          {
            itemId: 1,
            title: "t",
            chosenUrl: "https://x.test",
            confidence: 0.9,
            query: "q",
            status: "dryRun",
          },
        ],
      } satisfies FillSourceUrlsProgress);
      return fakeSummary("dryRun");
    }) as any;
    const store = new FillSourceUrlsJobStore({ runner: fakeRunner });
    const job = store.start({});
    await tick();
    const final = store.get(job.jobId)!;
    assert.equal(final.progress.processed, 1);
    assert.equal(final.progress.results.length, 1);
    // Snapshot must be a deep clone — mutation must not bleed back.
    final.progress.results.push({} as any);
    const again = store.get(job.jobId)!;
    assert.equal(again.progress.results.length, 1);
  });

  it("records error status on runner throw", async () => {
    const fakeRunner = (async () => {
      throw new Error("boom");
    }) as any;
    const store = new FillSourceUrlsJobStore({ runner: fakeRunner });
    const job = store.start({});
    await tick();
    const final = store.get(job.jobId)!;
    assert.equal(final.status, "error");
    assert.match(final.error ?? "", /boom/);
  });

  it("cancel transitions a running job to cancelled", async () => {
    const fakeRunner = (async (opts: any) => {
      // Spin until aborted.
      while (!opts.signal?.aborted) {
        await new Promise((r) => setImmediate(r));
      }
      throw new FillSourceUrlsAbortError();
    }) as any;
    const store = new FillSourceUrlsJobStore({ runner: fakeRunner });
    const job = store.start({});
    assert.equal(job.status, "running");
    const ok = store.cancel(job.jobId);
    assert.equal(ok, true);
    await tick();
    await tick();
    const final = store.get(job.jobId)!;
    assert.equal(final.status, "cancelled");
  });

  it("cancel returns false for unknown or finished jobs", async () => {
    const fakeRunner = (async () => fakeSummary("dryRun")) as any;
    const store = new FillSourceUrlsJobStore({ runner: fakeRunner });
    assert.equal(store.cancel("does-not-exist"), false);
    const job = store.start({});
    await tick();
    assert.equal(store.get(job.jobId)!.status, "done");
    assert.equal(store.cancel(job.jobId), false);
  });

  it("get returns undefined for unknown jobs", () => {
    const store = new FillSourceUrlsJobStore({
      runner: (async () => fakeSummary("dryRun")) as any,
    });
    assert.equal(store.get("no-such-id"), undefined);
  });

  it("evicts finished jobs after TTL", async () => {
    let nowMs = 1000;
    const fakeRunner = (async () => fakeSummary("dryRun")) as any;
    const store = new FillSourceUrlsJobStore({
      runner: fakeRunner,
      ttlMs: 100,
      now: () => nowMs,
    });
    const job = store.start({});
    await tick();
    assert.ok(store.get(job.jobId));
    nowMs += 10_000;
    assert.equal(store.get(job.jobId), undefined);
  });

  it("returns distinct jobIds for separate starts", () => {
    const store = new FillSourceUrlsJobStore({
      runner: (async () => fakeSummary("dryRun")) as any,
    });
    const a = store.start({});
    const b = store.start({});
    assert.notEqual(a.jobId, b.jobId);
  });
});
