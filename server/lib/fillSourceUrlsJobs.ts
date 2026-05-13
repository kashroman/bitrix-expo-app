/**
 * In-memory job runner for the Source URL fill job.
 *
 * Single-process by design — appropriate for the Yandex Serverless Container /
 * Render single-instance topology used by this app. A cold start (container
 * eviction) drops all jobs; that is documented in the admin UI and considered
 * acceptable for an operator-driven maintenance job that can be re-run.
 *
 * Safety invariants are NOT enforced here — they live in runFillSourceUrls.
 * This module only adds async orchestration, progress capture, cancellation,
 * and TTL-based cleanup.
 */
import { randomUUID } from "node:crypto";
import {
  runFillSourceUrls,
  FillSourceUrlsAbortError,
  type FillSourceUrlsItemResult,
  type FillSourceUrlsOptions,
  type FillSourceUrlsProgress,
  type FillSourceUrlsSummary,
} from "./fillSourceUrls.ts";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type FillSourceUrlsJobInput = Pick<
  FillSourceUrlsOptions,
  | "dryRun"
  | "limit"
  | "minConfidence"
  | "allowUnlisted"
  | "sleepMs"
  | "since"
  | "todayIso"
>;

export type FillSourceUrlsJob = {
  jobId: string;
  status: JobStatus;
  mode: "dryRun" | "apply";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  input: FillSourceUrlsJobInput;
  progress: FillSourceUrlsProgress;
  summary?: FillSourceUrlsSummary;
  error?: string;
};

const TTL_MS_DEFAULT = 60 * 60 * 1000; // keep finished jobs for 1h
const MAX_JOBS = 32;

type Internal = {
  job: FillSourceUrlsJob;
  controller: AbortController;
};

export class FillSourceUrlsJobStore {
  private readonly jobs = new Map<string, Internal>();

  constructor(
    private readonly opts: {
      ttlMs?: number;
      now?: () => number;
      runner?: typeof runFillSourceUrls;
    } = {},
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Drop finished jobs older than TTL; cap total entries. */
  private gc(): void {
    const ttl = this.opts.ttlMs ?? TTL_MS_DEFAULT;
    const now = this.now();
    const toDelete: string[] = [];
    this.jobs.forEach((entry, id) => {
      const j = entry.job;
      if (
        (j.status === "done" || j.status === "error" || j.status === "cancelled") &&
        typeof j.finishedAt === "number" &&
        now - j.finishedAt > ttl
      ) {
        toDelete.push(id);
      }
    });
    for (const id of toDelete) this.jobs.delete(id);
    if (this.jobs.size > MAX_JOBS) {
      const entries: Array<[string, Internal]> = [];
      this.jobs.forEach((entry, id) => entries.push([id, entry]));
      entries.sort((a, b) => a[1].job.createdAt - b[1].job.createdAt);
      while (this.jobs.size > MAX_JOBS && entries.length) {
        const [id] = entries.shift()!;
        this.jobs.delete(id);
      }
    }
  }

  /** Public snapshot — never expose the AbortController. */
  private snapshot(entry: Internal): FillSourceUrlsJob {
    return JSON.parse(JSON.stringify(entry.job)) as FillSourceUrlsJob;
  }

  get(jobId: string): FillSourceUrlsJob | undefined {
    this.gc();
    const entry = this.jobs.get(jobId);
    return entry ? this.snapshot(entry) : undefined;
  }

  list(): FillSourceUrlsJob[] {
    this.gc();
    const out: FillSourceUrlsJob[] = [];
    this.jobs.forEach((entry) => out.push(this.snapshot(entry)));
    return out;
  }

  cancel(jobId: string): boolean {
    const entry = this.jobs.get(jobId);
    if (!entry) return false;
    if (
      entry.job.status === "done" ||
      entry.job.status === "error" ||
      entry.job.status === "cancelled"
    ) {
      return false;
    }
    entry.controller.abort();
    return true;
  }

  /**
   * Start a new job. Returns immediately with the queued job. The actual work
   * runs on the event loop in a detached promise; callers must poll via get().
   */
  start(
    input: FillSourceUrlsJobInput,
    injected?: Parameters<typeof runFillSourceUrls>[1],
  ): FillSourceUrlsJob {
    this.gc();
    const jobId = randomUUID();
    const dryRun = input.dryRun !== false;
    const controller = new AbortController();
    const created = this.now();
    const initial: FillSourceUrlsJob = {
      jobId,
      status: "queued",
      mode: dryRun ? "dryRun" : "apply",
      createdAt: created,
      input,
      progress: {
        phase: "scanning",
        scanned: 0,
        future: 0,
        futureEmpty: 0,
        queue: 0,
        processed: 0,
        results: [],
      },
    };
    const entry: Internal = { job: initial, controller };
    this.jobs.set(jobId, entry);

    const runner = this.opts.runner ?? runFillSourceUrls;
    const opts: FillSourceUrlsOptions = {
      dryRun,
      limit: input.limit,
      minConfidence: input.minConfidence,
      allowUnlisted: input.allowUnlisted,
      sleepMs: input.sleepMs,
      since: input.since,
      todayIso: input.todayIso,
      signal: controller.signal,
      onProgress: (p) => {
        entry.job.progress = {
          phase: p.phase,
          scanned: p.scanned,
          future: p.future,
          futureEmpty: p.futureEmpty,
          queue: p.queue,
          processed: p.processed,
          results: p.results.slice() as FillSourceUrlsItemResult[],
        };
      },
    };

    entry.job.status = "running";
    entry.job.startedAt = this.now();

    // Detached — caller never awaits.
    (async () => {
      try {
        const summary = await runner(opts, injected);
        entry.job.summary = summary;
        entry.job.status = "done";
      } catch (err) {
        if (err instanceof FillSourceUrlsAbortError || controller.signal.aborted) {
          entry.job.status = "cancelled";
        } else {
          entry.job.status = "error";
          entry.job.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        entry.job.finishedAt = this.now();
      }
    })().catch(() => {
      // Swallow — status/error are already set above. This catch only exists
      // so an unhandled rejection cannot crash the process.
    });

    return this.snapshot(entry);
  }
}

export const fillSourceUrlsJobs = new FillSourceUrlsJobStore();
