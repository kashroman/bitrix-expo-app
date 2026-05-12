/**
 * Admin panel for the protected POST /api/admin/fill-source-urls endpoint.
 *
 * UX safety contract:
 *  - the token field is NOT persisted to localStorage / sessionStorage
 *  - the first call is ALWAYS dryRun=true; the Apply button stays disabled
 *    until a dry-run has succeeded, and clicking it requires an explicit
 *    second confirmation
 *  - apply writes are clearly labelled as "пишет в Bitrix24"
 */
import { useState } from "react";
import { Loader2, Play, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ItemResult = {
  itemId: number;
  title: string;
  chosenUrl: string;
  confidence: number;
  query: string;
  status:
    | "found"
    | "updated"
    | "dryRun"
    | "skippedLowConfidence"
    | "skippedAggregator"
    | "skippedNotAllowlisted"
    | "skippedNoResults"
    | "skippedError";
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

type ErrorBody = { error?: string; message?: string };

async function callFillEndpoint(
  token: string,
  body: { dryRun: boolean; limit: number },
): Promise<Summary> {
  const res = await fetch("/api/admin/fill-source-urls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token,
    },
    body: JSON.stringify(body),
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
  return (await res.json()) as Summary;
}

export function FillSourceUrlsPanel() {
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(20);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, setPending] = useState<null | "dry" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dryRunCompleted = summary?.mode === "dryRun";
  const hasApplyEligible =
    dryRunCompleted && summary && summary.dryRunApplyEligible > 0;

  async function runDry() {
    if (!token.trim()) {
      setError("Введите admin token (env ADMIN_JOB_TOKEN на Render).");
      return;
    }
    setError(null);
    setConfirming(false);
    setPending("dry");
    try {
      const result = await callFillEndpoint(token.trim(), {
        dryRun: true,
        limit,
      });
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setPending(null);
    }
  }

  async function runApply() {
    if (!summary || summary.mode !== "dryRun") {
      setError("Сначала выполните успешный dry-run.");
      return;
    }
    setError(null);
    setConfirming(false);
    setPending("apply");
    try {
      const result = await callFillEndpoint(token.trim(), {
        dryRun: false,
        limit,
      });
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

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
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">ADMIN_JOB_TOKEN</code>
          на Render.
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
            onClick={runDry}
            disabled={pending !== null || !token.trim()}
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
        </div>

        {!dryRunCompleted && (
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

        {summary && (
          <SummaryView summary={summary} />
        )}
      </CardContent>
    </Card>
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
