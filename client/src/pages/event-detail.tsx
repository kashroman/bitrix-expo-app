import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shell, PageTitle, LoadingRows } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import {
  buildExpoAggregate,
  fetchDealStages,
  statusTitleMap,
} from "@/lib/expo-data";
import type { CrmItem } from "@/lib/bitrix";
import { LinkFieldChoice, summarizeSettings } from "@/lib/expo-link";
import {
  EXPO_ENTITY_TYPE_ID,
  DealGroupKey,
  LeadGroupKey,
  candidateDealStatusByName,
  dealExpoFieldCode,
  matchDealStatus,
} from "@/lib/config";
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
            <LoadedDealsDiagnostics
              deals={foundData.deals}
              dealChoice={foundData.diagnostics.deal}
              expoId={foundData.expo.id}
              expoTitle={foundData.expo.title}
            />
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
        {choice.manualFormatOverrideActive ? (
          <div>
            Format override: <code>{choice.manualFormatOverride ?? "—"}</code> ·{" "}
            <span className="text-emerald-700 dark:text-emerald-300">активен</span>
            {choice.sampleValues && choice.sampleValues.length > 0 ? (
              <div className="mt-0.5 text-muted-foreground">
                Sample: {choice.sampleValues.map((s) => `id=${s.id ?? "?"} · value=${JSON.stringify(s.value)}`).join("; ")}
              </div>
            ) : null}
          </div>
        ) : null}
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

const LOADED_DEAL_HIGHLIGHT: Record<
  "signingContract" | "building" | "projectCompleted",
  string
> = {
  signingContract:
    "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100",
  building: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  projectCompleted:
    "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
};

function linkValueOf(
  deal: Record<string, unknown>,
  fieldCode: string | undefined,
): string | undefined {
  if (!fieldCode) return undefined;
  const variants = [
    fieldCode,
    fieldCode.toUpperCase(),
    fieldCode.toLowerCase(),
    fieldCode.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase()),
  ];
  for (const key of variants) {
    const v = deal[key];
    if (v !== undefined && v !== null && v !== "") {
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
  }
  return undefined;
}

function dealClientOf(deal: Record<string, unknown>): string | undefined {
  const fromCompany =
    deal.COMPANY_TITLE ?? deal.companyTitle ?? deal.COMPANY_NAME ?? deal.companyName;
  if (typeof fromCompany === "string" && fromCompany) return fromCompany;
  const contactName = deal.CONTACT_NAME ?? deal.contactName;
  if (typeof contactName === "string" && contactName) return contactName;
  const companyId = deal.COMPANY_ID ?? deal.companyId;
  if (companyId !== undefined && companyId !== null && companyId !== "" && companyId !== "0") {
    return `company #${companyId}`;
  }
  const contactId = deal.CONTACT_ID ?? deal.contactId;
  if (contactId !== undefined && contactId !== null && contactId !== "" && contactId !== "0") {
    return `contact #${contactId}`;
  }
  return undefined;
}

function LoadedDealsDiagnostics({
  deals,
  dealChoice,
  expoId,
  expoTitle,
}: {
  deals: CrmItem[];
  dealChoice: LinkFieldChoice;
  expoId: number | string;
  expoTitle: string;
}) {
  const stagesQuery = useQuery({
    queryKey: ["deal-stages"],
    queryFn: fetchDealStages,
    enabled: isInsideBitrix(),
    staleTime: 5 * 60_000,
  });
  const titleById = useMemo(
    () => statusTitleMap(stagesQuery.data ?? []),
    [stagesQuery.data],
  );
  const linkField = dealChoice.chosenField ?? dealExpoFieldCode ?? undefined;

  const rows = useMemo(() => {
    return deals.map((deal) => {
      const r = deal as Record<string, unknown>;
      const stageId = String(r.STAGE_ID ?? r.stageId ?? "");
      const stageTitle = stageId ? titleById.get(stageId) : undefined;
      const exact = matchDealStatus(stageId, stageTitle);
      const candidate = exact ?? candidateDealStatusByName(stageTitle);
      return {
        id: String(r.ID ?? r.id ?? ""),
        title: String(r.TITLE ?? r.title ?? ""),
        stageId,
        stageTitle,
        stageSemanticId: r.STAGE_SEMANTIC_ID
          ? String(r.STAGE_SEMANTIC_ID)
          : r.stageSemanticId
            ? String(r.stageSemanticId)
            : undefined,
        categoryId: r.CATEGORY_ID
          ? String(r.CATEGORY_ID)
          : r.categoryId
            ? String(r.categoryId)
            : undefined,
        opportunity:
          r.OPPORTUNITY !== undefined && r.OPPORTUNITY !== null && r.OPPORTUNITY !== ""
            ? String(r.OPPORTUNITY)
            : r.opportunity !== undefined && r.opportunity !== null && r.opportunity !== ""
              ? String(r.opportunity)
              : undefined,
        currencyId: r.CURRENCY_ID
          ? String(r.CURRENCY_ID)
          : r.currencyId
            ? String(r.currencyId)
            : undefined,
        assignedById: r.ASSIGNED_BY_ID
          ? String(r.ASSIGNED_BY_ID)
          : r.assignedById
            ? String(r.assignedById)
            : undefined,
        client: dealClientOf(r),
        linkValue: linkValueOf(r, linkField),
        exact,
        candidate,
      };
    });
  }, [deals, titleById, linkField]);

  return (
    <Card data-testid="card-loaded-deals-diag">
      <CardHeader>
        <CardTitle className="text-base">
          Загруженные сделки для выставки · диагностика
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="text-muted-foreground">
          Список сделок, действительно пришедших из{" "}
          <code>crm.deal.list</code> по полю{" "}
          <code>{linkField ?? "—"}</code> для выставки <b>{expoTitle}</b> (
          <code>#{expoId}</code>). Используйте эти <code>STAGE_ID</code>, чтобы
          закрепить значения в <code>dealStageIds</code>, если общий справочник
          стадий не читается.
        </div>
        {rows.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-muted-foreground">
            Сделок не загружено. Проверьте диагностику связи ниже.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-[11px]"
              data-testid="loaded-deals-diag-table"
            >
              <thead>
                <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1">Deal ID</th>
                  <th className="px-2 py-1">Title</th>
                  <th className="px-2 py-1">STAGE_ID</th>
                  <th className="px-2 py-1">Stage title</th>
                  <th className="px-2 py-1">Semantic</th>
                  <th className="px-2 py-1">Category</th>
                  <th className="px-2 py-1">Opportunity</th>
                  <th className="px-2 py-1">Assigned</th>
                  <th className="px-2 py-1">Клиент</th>
                  <th className="px-2 py-1">
                    Link value (<code>{linkField ?? "—"}</code>)
                  </th>
                  <th className="px-2 py-1">Match</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = row.exact ?? row.candidate;
                  const cls = key ? LOADED_DEAL_HIGHLIGHT[key] : "";
                  return (
                    <tr
                      key={row.id}
                      className={`border-b align-top ${cls}`}
                      data-testid={`loaded-deals-diag-row-${row.id}`}
                    >
                      <td className="px-2 py-1 font-mono">#{row.id}</td>
                      <td className="px-2 py-1">{row.title || "—"}</td>
                      <td className="px-2 py-1 font-mono">{row.stageId || "—"}</td>
                      <td className="px-2 py-1">{row.stageTitle || "—"}</td>
                      <td className="px-2 py-1 font-mono">
                        {row.stageSemanticId ?? "—"}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {row.categoryId ?? "—"}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {row.opportunity
                          ? `${row.opportunity}${row.currencyId ? " " + row.currencyId : ""}`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {row.assignedById ?? "—"}
                      </td>
                      <td className="px-2 py-1">{row.client ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">
                        {row.linkValue ?? "—"}
                      </td>
                      <td className="px-2 py-1">
                        {row.exact ? (
                          <span>
                            <b>точное</b>
                          </span>
                        ) : row.candidate ? (
                          <span>кандидат</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
