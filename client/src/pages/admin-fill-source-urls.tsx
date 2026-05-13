/**
 * Admin panel for the protected fill-source-urls job endpoints.
 *
 * UX safety contract:
 *  - the token field is NOT persisted to localStorage / sessionStorage
 *  - the first call is ALWAYS dryRun=true; the Apply button stays disabled
 *    until a dry-run has finished, and clicking it requires an explicit
 *    second confirmation
 *  - apply writes are clearly labelled as "пишет в Bitrix24"
 *
 * The panel uses the async job API (POST /jobs + GET /jobs/:id) so long-running
 * scans do not time out on the Yandex Serverless Container / Render proxy. The
 * job runs in-memory in a single process — if the container cold-starts, the
 * job is lost. Operators can simply re-run.
 */
import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Play,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

type ItemStatus =
  | "found"
  | "updated"
  | "dryRun"
  | "skippedLowConfidence"
  | "skippedAggregator"
  | "skippedNotAllowlisted"
  | "skippedNoResults"
  | "skippedError";

type ItemResult = {
  itemId: number;
  title: string;
  chosenUrl: string;
  confidence: number;
  query: string;
  status: ItemStatus;
  allowlisted?: boolean;
  applyEligible?: boolean;
  note?: string;
};

type Summary = {
  mode: "dryRun" | "apply";
  todayIso: string;
  minConfidence: number;
  limit: number;
  allowUnlisted: boolean;
  scanned: number;
  future: number;
  futureEmpty: number;
  queue: number;
  found: number;
  updated: number;
  skippedLowConfidence: number;
  skippedAggregator: number;
  skippedNotAllowlisted: number;
  skippedNoResults: number;
  errors: number;
  dryRunApplyEligible: number;
  dryRunNotAllowlisted: number;
  allowlistEntries: number;
  results: ItemResult[];
};

type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

type Job = {
  jobId: string;
  status: JobStatus;
  mode: "dryRun" | "apply";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  input: {
    dryRun?: boolean;
    limit?: number;
  };
  progress: {
    phase: "scanning" | "processing" | "done";
    scanned: number;
    future: number;
    futureEmpty: number;
    queue: number;
    processed: number;
    results: ItemResult[];
  };
  summary?: Summary;
  error?: string;
};

type ErrorBody = { error?: string; message?: string };

async function apiFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let info: ErrorBody = {};
    try {
      info = (await res.json()) as ErrorBody;
    } catch {
      info = { message: await res.text() };
    }
    const label = info.error ?? `http-${res.status}`;
    throw new Error(`${label}: ${info.message ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

async function startJob(
  token: string,
  body: { dryRun: boolean; limit: number },
): Promise<Job> {
  return apiFetch<Job>("/api/admin/fill-source-urls/jobs", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function getJob(token: string, jobId: string): Promise<Job> {
  return apiFetch<Job>(
    `/api/admin/fill-source-urls/jobs/${encodeURIComponent(jobId)}`,
    token,
    { method: "GET" },
  );
}

async function cancelJob(token: string, jobId: string): Promise<Job> {
  return apiFetch<Job>(
    `/api/admin/fill-source-urls/jobs/${encodeURIComponent(jobId)}/cancel`,
    token,
    { method: "POST" },
  );
}

const POLL_MS = 1500;

export function FillSourceUrlsPanel() {
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(20);
  const [job, setJob] = useState<Job | null>(null);
  const [pending, setPending] = useState<null | "dry" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const isTerminal =
    job?.status === "done" ||
    job?.status === "error" ||
    job?.status === "cancelled";
  const isRunning =
    job?.status === "queued" || job?.status === "running";
  const lastSummary = job?.summary;
  const dryRunCompleted =
    job?.status === "done" && job?.mode === "dryRun" && Boolean(lastSummary);
  const hasApplyEligible =
    dryRunCompleted &&
    lastSummary !== undefined &&
    lastSummary.dryRunApplyEligible > 0;

  function pollLoop(activeToken: string, jobId: string) {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      try {
        const next = await getJob(activeToken, jobId);
        setJob(next);
        if (
          next.status === "done" ||
          next.status === "error" ||
          next.status === "cancelled"
        ) {
          setPending(null);
          return;
        }
        pollLoop(activeToken, jobId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPending(null);
      }
    }, POLL_MS);
  }

  async function launch(mode: "dry" | "apply") {
    if (!token.trim()) {
      setError("Введите admin token (env ADMIN_JOB_TOKEN на сервере).");
      return;
    }
    setError(null);
    setConfirming(false);
    setPending(mode);
    setJob(null);
    try {
      const started = await startJob(token.trim(), {
        dryRun: mode === "dry",
        limit,
      });
      setJob(started);
      pollLoop(token.trim(), started.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  }

  async function onCancel() {
    if (!job || !isRunning) return;
    try {
      const updated = await cancelJob(token.trim(), job.jobId);
      setJob(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runApply() {
    if (!dryRunCompleted) {
      setError("Сначала выполните успешный dry-run.");
      return;
    }
    await launch("apply");
  }

  const queueTotal = job?.progress.queue ?? 0;
  const processed = job?.progress.processed ?? 0;
  const progressPct =
    queueTotal > 0 ? Math.min(100, Math.round((processed / queueTotal) * 100)) : 0;

  return (
    <Card data-testid="card-admin-fill">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Заполнение «Источник (URL)» — admin
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Ищет официальный сайт для будущих карточек выставок с пустым полем
          «Источник (URL)». Никогда не перезаписывает уже заполненные ссылки.
          Запускается только из этой панели — токен берётся из env
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
            ADMIN_JOB_TOKEN
          </code>
          на сервере.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Задание выполняется асинхронно. При cold-start контейнера прогресс
          теряется — можно перезапустить.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="admin-token">Admin token</Label>
            <Input
              id="admin-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="x-admin-token (не сохраняется)"
              data-testid="input-admin-token"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="admin-limit">Limit</Label>
            <Input
              id="admin-limit"
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(e) =>
                setLimit(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
              }
              data-testid="input-admin-limit"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => launch("dry")}
            disabled={pending !== null || !token.trim() || isRunning}
            data-testid="button-admin-dry-run"
          >
            {pending === "dry" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Dry-run заполнения URL
          </Button>
          {!confirming ? (
            <Button
              variant="destructive"
              onClick={() => setConfirming(true)}
              disabled={
                pending !== null ||
                isRunning ||
                !dryRunCompleted ||
                !hasApplyEligible
              }
              data-testid="button-admin-apply"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Apply (пишет в Bitrix24)
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1">
              <span className="text-xs text-destructive">
                Подтвердить запись в CRM?
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={runApply}
                disabled={pending !== null}
                data-testid="button-admin-apply-confirm"
              >
                {pending === "apply" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Да, записать
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={pending !== null}
                data-testid="button-admin-apply-cancel"
              >
                Отмена
              </Button>
            </div>
          )}
          {isRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={onCancel}
              data-testid="button-admin-cancel-job"
            >
              <XCircle className="mr-1 h-3 w-3" />
              Отменить job
            </Button>
          )}
        </div>

        {!dryRunCompleted && !isRunning && (
          <p className="text-xs text-muted-foreground">
            Кнопка Apply активируется после успешного dry-run, если найдены
            кандидаты в allowlist.
          </p>
        )}

        {error && (
          <div
            className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
            data-testid="text-admin-error"
          >
            {error}
          </div>
        )}

        {job && (
          <JobProgressView
            job={job}
            progressPct={progressPct}
            queueTotal={queueTotal}
            processed={processed}
          />
        )}

        {job && isTerminal && job.summary && (
          <SummaryView summary={job.summary} />
        )}
      </CardContent>
    </Card>
  );
}

function JobProgressView({
  job,
  progressPct,
  queueTotal,
  processed,
}: {
  job: Job;
  progressPct: number;
  queueTotal: number;
  processed: number;
}) {
  const phaseLabel =
    job.status === "queued"
      ? "Очередь…"
      : job.status === "running" && job.progress.phase === "scanning"
        ? "Сканирование CRM…"
        : job.status === "running"
          ? "Обработка кандидатов…"
          : job.status === "cancelled"
            ? "Отменено"
            : job.status === "error"
              ? "Ошибка"
              : "Готово";
  return (
    <div
      className="rounded border bg-muted/30 p-2 text-xs"
      data-testid="block-admin-progress"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{phaseLabel}</span>
        <span className="font-mono text-muted-foreground">
          {processed}/{queueTotal || "?"}
        </span>
      </div>
      <Progress className="mt-1 h-1.5" value={progressPct} />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>jobId: <span className="font-mono">{job.jobId.slice(0, 8)}…</span></span>
        <span>mode: {job.mode}</span>
        <span>scanned: {job.progress.scanned}</span>
        <span>future: {job.progress.future}</span>
        <span>futureEmpty: {job.progress.futureEmpty}</span>
      </div>
      {job.error && (
        <div className="mt-1 text-red-600 dark:text-red-300">
          {job.error}
        </div>
      )}
    </div>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  const isApply = summary.mode === "apply";
  return (
    <div className="space-y-3" data-testid="block-admin-summary">
      <div
        className={`rounded border p-2 text-xs ${
          isApply
            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        }`}
      >
        <div className="flex items-center gap-2 font-medium">
          {isApply ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <ShieldCheck className="h-3 w-3" />
          )}
          {isApply
            ? `Apply завершён: записано ${summary.updated} карточек`
            : `Dry-run завершён: ${summary.dryRunApplyEligible} готовы к записи`}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-4">
          <Stat label="scanned" value={summary.scanned} />
          <Stat label="future" value={summary.future} />
          <Stat label="futureEmpty" value={summary.futureEmpty} />
          <Stat label="queue" value={summary.queue} />
          <Stat label="found" value={summary.found} />
          <Stat label="updated" value={summary.updated} />
          <Stat label="lowConfidence" value={summary.skippedLowConfidence} />
          <Stat label="aggregator" value={summary.skippedAggregator} />
          <Stat label="notAllowlisted" value={summary.skippedNotAllowlisted} />
          <Stat label="noResults" value={summary.skippedNoResults} />
          <Stat label="errors" value={summary.errors} />
          {!isApply ? (
            <Stat
              label="applyEligible"
              value={summary.dryRunApplyEligible}
            />
          ) : null}
        </div>
      </div>

      {summary.results.length > 0 && (
        <div className="max-h-96 overflow-auto rounded border">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted/60">
              <tr className="text-left">
                <th className="px-2 py-1">id</th>
                <th className="px-2 py-1">status</th>
                <th className="px-2 py-1">conf</th>
                <th className="px-2 py-1">allow</th>
                <th className="px-2 py-1">title</th>
                <th className="px-2 py-1">url</th>
              </tr>
            </thead>
            <tbody>
              {summary.results.map((r) => (
                <tr
                  key={r.itemId}
                  className="border-t align-top"
                  data-testid={`row-admin-${r.itemId}`}
                >
                  <td className="px-2 py-1 font-mono">{r.itemId}</td>
                  <td className="px-2 py-1">{r.status}</td>
                  <td className="px-2 py-1 font-mono">
                    {r.confidence.toFixed(2)}
                  </td>
                  <td className="px-2 py-1">
                    {r.allowlisted === undefined
                      ? ""
                      : r.allowlisted
                        ? "Y"
                        : "N"}
                  </td>
                  <td className="px-2 py-1">«{r.title}»</td>
                  <td className="px-2 py-1 break-all">
                    {r.chosenUrl ? (
                      <a
                        href={r.chosenUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {r.chosenUrl}
                      </a>
                    ) : (
                      "—"
                    )}
                    {r.note ? (
                      <span className="ml-1 text-muted-foreground">
                        ({r.note})
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
