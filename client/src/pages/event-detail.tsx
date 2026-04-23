import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shell, PageTitle, LoadingRows } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import { buildExpoAggregate } from "@/lib/expo-data";
import { LinkFieldChoice, summarizeSettings } from "@/lib/expo-link";
import { EXPO_ENTITY_TYPE_ID, DealGroupKey, LeadGroupKey } from "@/lib/config";
import { formatDateRange } from "@/lib/format";
import { isInsideBitrix, openBitrixPath } from "@/lib/bitrix";

export default function EventDetailPage({ params }: { params: { eventId: string } }) {
  const eventId = params.eventId;
  const inBitrix = isInsideBitrix();
  const agg = useQuery({
    queryKey: ["expo-aggregate", Number(eventId)],
    queryFn: () => buildExpoAggregate(eventId),
    enabled: inBitrix && Boolean(eventId),
  });

  const foundData = agg.data && agg.data.status === "found" ? agg.data : undefined;
  const notFoundData = agg.data && agg.data.status === "not-found" ? agg.data : undefined;
  const title = foundData?.expo.title ?? `Выставка #${eventId}`;

  return (
    <Shell>
      <div className="mb-4 flex items-center gap-2">
        <Link href="/calendar">
          <a
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-calendar"
          >
            <ArrowLeft className="h-4 w-4" />
            Ко всему календарю
          </a>
        </Link>
      </div>

      <PageTitle eyebrow="Выставка" title={title} description={`ID выставки: ${eventId}`} />

      {!inBitrix ? (
        <DemoState eventId={eventId} />
      ) : agg.isLoading ? (
        <LoadingRows />
      ) : agg.isError ? (
        <ErrorState
          eventId={eventId}
          message={String((agg.error as Error)?.message ?? agg.error)}
          onRetry={() => agg.refetch()}
        />
      ) : notFoundData ? (
        <>
          <NotFoundState eventId={eventId} errors={notFoundData.diagnostics.errors} />
          <div className="mt-4">
            <LinkDiagnosticsCard
              leadChoice={notFoundData.diagnostics.lead}
              dealChoice={notFoundData.diagnostics.deal}
              errors={notFoundData.diagnostics.errors}
            />
          </div>
        </>
      ) : foundData ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Информация о выставке</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <FieldLine label="ID" value={String(foundData.expo.id)} />
                <FieldLine label="Название" value={foundData.expo.title} />
                <FieldLine label="Проведение" value={formatDateRange(foundData.expo.expoStart, foundData.expo.expoEnd)} />
                <FieldLine label="Монтаж" value={formatDateRange(foundData.expo.installStart, foundData.expo.installEnd)} />
                <FieldLine label="Демонтаж" value={formatDateRange(foundData.expo.dismantleStart, foundData.expo.dismantleEnd)} />
                {foundData.expo.responsibleId && (
                  <FieldLine label="Ответственный ID" value={String(foundData.expo.responsibleId)} />
                )}
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openBitrixPath(`/crm/type/${EXPO_ENTITY_TYPE_ID}/details/${foundData.expo.id}/`)}
                    data-testid="button-open-in-bitrix"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Открыть в Bitrix24
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">KPI</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Kpi label="Лидов" value={foundData.leadStats.total} />
                  <Kpi label="Успешных" value={foundData.leadStats.success} tone="success" />
                  <Kpi label="Сделок" value={foundData.dealStats.total} />
                  <Kpi label="Выигранных" value={foundData.dealStats.won} tone="success" />
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Воронка лидов</CardTitle>
                <Link href={`/event/${eventId}/leads`}>
                  <a className="text-sm text-primary hover:underline" data-testid="link-all-leads">Все лиды</a>
                </Link>
              </CardHeader>
              <CardContent>
                <LeadFunnel
                  stats={foundData.leadStats}
                  onSelect={(group: LeadGroupKey) => {
                    window.location.hash = `/event/${eventId}/leads?group=${group}`;
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Воронка сделок</CardTitle>
                <Link href={`/event/${eventId}/deals`}>
                  <a className="text-sm text-primary hover:underline" data-testid="link-all-deals">Все сделки</a>
                </Link>
              </CardHeader>
              <CardContent>
                <DealFunnel
                  stats={foundData.dealStats}
                  onSelect={(group: DealGroupKey) => {
                    window.location.hash = `/event/${eventId}/deals?group=${group}`;
                  }}
                />
              </CardContent>
            </Card>
          </div>

          <div className="mt-4">
            <LinkDiagnosticsCard
              leadChoice={foundData.diagnostics.lead}
              dealChoice={foundData.diagnostics.deal}
              errors={foundData.diagnostics.errors}
            />
          </div>
        </>
      ) : null}
    </Shell>
  );
}

function DemoState({ eventId }: { eventId: string }) {
  return (
    <Card
      className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
      data-testid="status-demo"
    >
      <CardHeader>
        <CardTitle className="text-lg">Демо-режим вне Bitrix24</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Сводка по выставке <strong>#{eventId}</strong> доступна только внутри Bitrix24, где есть авторизованный
          SDK (<code>BX24</code>). Здесь показан только каркас страницы — данные CRM не загружаются и нигде не
          сохраняются.
        </p>
        <p className="text-muted-foreground">
          Чтобы увидеть реальные данные, откройте приложение из меню Bitrix24: CRM → Аналитика → Календарь выставок,
          либо вкладку «Выставка» у сделки или лида.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/calendar">
            <a>
              <Button variant="default" size="sm" data-testid="button-go-calendar">
                <ArrowLeft className="mr-2 h-4 w-4" />К списку выставок
              </Button>
            </a>
          </Link>
          <Link href="/install">
            <a>
              <Button variant="outline" size="sm" data-testid="button-go-install">
                Установка placement-ов
              </Button>
            </a>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function NotFoundState({ eventId, errors }: { eventId: string; errors?: string[] }) {
  const hasErrors = Array.isArray(errors) && errors.length > 0;
  return (
    <Card data-testid="status-not-found">
      <CardHeader>
        <CardTitle className="text-lg">Выставка #{eventId} не найдена</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Возможно, элемент смарт-процесса удалён, у пользователя нет прав на чтение, либо метод{" "}
          <code>crm.item.get</code> вернул ошибку.
        </p>
        {hasErrors && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-medium">Подробности:</div>
            <ul className="mt-1 list-disc pl-5">
              {errors!.map((err, i) => (
                <li key={i} className="break-all">{err}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/calendar">
            <a>
              <Button variant="default" size="sm" data-testid="button-go-calendar">
                <ArrowLeft className="mr-2 h-4 w-4" />К списку выставок
              </Button>
            </a>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({ eventId, message, onRetry }: { eventId: string; message: string; onRetry: () => void }) {
  return (
    <Card className="border-destructive/40" data-testid="status-error">
      <CardHeader>
        <CardTitle className="text-lg">Ошибка загрузки выставки #{eventId}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-destructive">{message}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="default" size="sm" onClick={onRetry} data-testid="button-retry">
            Повторить
          </Button>
          <Link href="/calendar">
            <a>
              <Button variant="outline" size="sm" data-testid="button-go-calendar">
                <ArrowLeft className="mr-2 h-4 w-4" />К списку выставок
              </Button>
            </a>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function LinkDiagnosticsCard({
  leadChoice,
  dealChoice,
  errors,
}: {
  leadChoice: LinkFieldChoice;
  dealChoice: LinkFieldChoice;
  errors: string[];
}) {
  return (
    <Card data-testid="card-link-diagnostics">
      <CardHeader>
        <CardTitle className="text-base">Диагностика связи «Выставка (календарь)»</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <ChoiceBlock title="Лиды" choice={leadChoice} />
        <ChoiceBlock title="Сделки" choice={dealChoice} />
        {errors.length > 0 && (
          <div className="text-red-600">Общие ошибки: {errors.join("; ")}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ChoiceBlock({ title, choice }: { title: string; choice: LinkFieldChoice }) {
  const customCount = choice.candidates.filter((c) => c.isCustom).length;
  const noResults = choice.attempted.length > 0 && choice.attempted.every((a) => a.count === 0);
  const chosenCount = choice.attempted.find(
    (a) => a.field === choice.chosenField && a.format === choice.chosenFormat,
  )?.count ?? 0;
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="font-medium">{title}</div>
      <div className="mt-1 grid gap-1">
        <div>
          Выбранное поле: <code>{choice.chosenField ?? "—"}</code>
          {choice.bestCandidate && choice.bestCandidate.code === choice.chosenField && choice.bestCandidate.title ? (
            <> · title: <span className="text-muted-foreground">{choice.bestCandidate.title}</span></>
          ) : null}
        </div>
        <div>
          Формат фильтра: <code>{choice.chosenFormat ?? "—"}</code>, записей: {chosenCount}
          {choice.usedFallback ? " (fallback на PARENT_ID)" : ""}
        </div>
        {choice.manualOverride ? (
          <div>
            Ручной override (config): <code>{choice.manualOverride}</code> ·{" "}
            {choice.manualOverrideActive ? (
              <span className="text-emerald-700 dark:text-emerald-300">активен</span>
            ) : (
              <span className="text-amber-700 dark:text-amber-300">не найден в fields</span>
            )}
            {choice.manualOverrideActive && choice.bestCandidate ? (
              <div className="mt-0.5 text-muted-foreground">
                {choice.bestCandidate.listLabel ? (
                  <>listLabel: <span className="text-foreground">{choice.bestCandidate.listLabel}</span> · </>
                ) : null}
                {choice.bestCandidate.formLabel ? (
                  <>formLabel: <span className="text-foreground">{choice.bestCandidate.formLabel}</span> · </>
                ) : null}
                type: <code>{choice.bestCandidate.type ?? "—"}</code>
                {summarizeSettings(choice.bestCandidate.settings) ? (
                  <> · settings: <code>{summarizeSettings(choice.bestCandidate.settings)}</code></>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div>
          Кастомных UF-кандидатов: {customCount}, всего кандидатов: {choice.totalCandidateCount || choice.candidates.length}
        </div>
        {choice.warnings && choice.warnings.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-1.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {choice.warnings.join("; ")}
          </div>
        )}
        {!choice.chosenField && noResults && (
          <div className="rounded border border-amber-300 bg-amber-50 p-1.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Ни один из форматов не вернул записей. См. список попыток ниже.
          </div>
        )}
        {choice.candidates.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Кандидаты полей ({choice.candidates.length})</summary>
            <ul className="mt-1 space-y-1">
              {choice.candidates.slice(0, 10).map((c) => (
                <li key={c.code} className="break-all">
                  <code>{c.code}</code> · {c.title || "—"} · type={c.type ?? "—"} · userTypeId={c.userTypeId ?? "—"} · score={c.score}
                  <div>{c.reason}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
        {choice.attempted.length > 0 && (
          <details className="text-muted-foreground" open={!choice.chosenField && noResults}>
            <summary className="cursor-pointer">Попытки фильтрации ({choice.attempted.length})</summary>
            <table className="mt-1 w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-left">
                  <th className="pr-2">field</th>
                  <th className="pr-2">format</th>
                  <th className="pr-2">count</th>
                  <th>error</th>
                </tr>
              </thead>
              <tbody>
                {choice.attempted.map((a, i) => (
                  <tr key={`${a.field}-${a.format}-${i}`} className="align-top">
                    <td className="pr-2 break-all"><code>{a.field}</code></td>
                    <td className="pr-2"><code>{a.format || "—"}</code></td>
                    <td className="pr-2 tabular-nums">{a.count}</td>
                    <td className="text-red-600">{a.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {choice.sampleValues && choice.sampleValues.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Пример значений ({choice.sampleValues.length})</summary>
            <ul className="mt-1 space-y-1">
              {choice.sampleValues.map((s, i) => (
                <li key={i}>
                  id={s.id ?? "—"}, value={JSON.stringify(s.value)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function FieldLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "success" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "success" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}
