import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shell, PageTitle, LoadingRows } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import {
  buildExpoAggregate,
  fetchDealStages,
  fetchBitrixCompanyNames,
  fetchBitrixContactNames,
  fetchBitrixUserNames,
  statusColorMap,
  statusTitleMap,
} from "@/lib/expo-data";
import type { CrmItem } from "@/lib/bitrix";
import { LinkFieldChoice, summarizeSettings } from "@/lib/expo-link";
import {
  EXPO_ENTITY_TYPE_ID,
  DealGroupKey,
  LeadGroupKey,
} from "@/lib/config";
import { formatDateRange } from "@/lib/format";
import { isInsideBitrix, openBitrixPath } from "@/lib/bitrix";
import { stageDisplayColor } from "@/lib/stage-colors";
import {
  DealTableSortKey,
  SortDirection,
  sortDealTableRows,
} from "@/lib/deal-table";

export default function EventDetailPage({
  params,
  embedded = false,
}: {
  params: { eventId: string };
  embedded?: boolean;
}) {
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
  const timeoutMessage = notFoundData?.diagnostics.errors.find((e) =>
    /таймаут|превышен общий бюджет/i.test(e),
  );

  return (
    <Shell embedded={embedded}>
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
      ) : timeoutMessage ? (
        <ErrorState
          eventId={eventId}
          message={timeoutMessage}
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
                  <Kpi label="Лидов" value={foundData.leadStats.total} href={`/event/${eventId}/leads`} />
                  <Kpi label="Успешных" value={foundData.leadStats.success} tone="success" href={`/event/${eventId}/leads?group=success`} />
                  <Kpi label="Сделок" value={foundData.dealStats.total} href={`/event/${eventId}/deals`} />
                  <Kpi label="Выигранных" value={foundData.dealStats.won} tone="success" href={`/event/${eventId}/deals?group=won`} />
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
            <ExhibitionDealsTable
              deals={foundData.deals}
              expoTitle={foundData.expo.title}
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

function Kpi({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone?: "success";
  href: string;
}) {
  return (
    <Link href={href}>
      <a className="block rounded-lg border bg-card p-3 transition hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary/50">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "success" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {value}
      </div>
      </a>
    </Link>
  );
}

function dealClientTitle(
  deal: Record<string, unknown>,
  companyNames: Map<string, string>,
  contactNames: Map<string, string>,
  isLoading: boolean,
): string {
  const fromCompany =
    deal.COMPANY_TITLE ?? deal.companyTitle ?? deal.COMPANY_NAME ?? deal.companyName;
  if (typeof fromCompany === "string" && fromCompany) return fromCompany;
  const companyId = String(deal.COMPANY_ID ?? deal.companyId ?? "").trim();
  if (companyId && companyId !== "0") {
    return companyNames.get(companyId) ?? (isLoading ? "Загрузка…" : "Компания не найдена");
  }

  const contactName = deal.CONTACT_NAME ?? deal.contactName;
  if (typeof contactName === "string" && contactName.trim()) return contactName.trim();
  const contactId = String(deal.CONTACT_ID ?? deal.contactId ?? "").trim();
  if (contactId && contactId !== "0") {
    return contactNames.get(contactId) ?? (isLoading ? "Загрузка…" : "Контакт не найден");
  }
  return "Клиент не указан";
}

function formatDealBudget(value: string | undefined, currency: string | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency || "RUB",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount)} ${currency || "RUB"}`;
  }
}

function ExhibitionDealsTable({
  deals,
  expoTitle,
}: {
  deals: CrmItem[];
  expoTitle: string;
}) {
  const [sort, setSort] = useState<{ key: DealTableSortKey; direction: SortDirection } | null>(null);
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
  const colorById = useMemo(
    () => statusColorMap(stagesQuery.data ?? []),
    [stagesQuery.data],
  );
  const stageById = useMemo(
    () => new Map((stagesQuery.data ?? []).map((stage) => [stage.id, stage])),
    [stagesQuery.data],
  );

  const relatedIds = useMemo(() => {
    const companies = new Set<string>();
    const contacts = new Set<string>();
    const managers = new Set<string>();
    deals.forEach((deal) => {
      const row = deal as Record<string, unknown>;
      const companyId = String(row.COMPANY_ID ?? row.companyId ?? "").trim();
      const contactId = String(row.CONTACT_ID ?? row.contactId ?? "").trim();
      const managerId = String(row.ASSIGNED_BY_ID ?? row.assignedById ?? "").trim();
      if (companyId && companyId !== "0") companies.add(companyId);
      if (contactId && contactId !== "0") contacts.add(contactId);
      if (managerId && managerId !== "0") managers.add(managerId);
    });
    return {
      companyIds: Array.from(companies).sort(),
      contactIds: Array.from(contacts).sort(),
      managerIds: Array.from(managers).sort(),
    };
  }, [deals]);

  const relatedQuery = useQuery({
    queryKey: ["deal-related-names", relatedIds],
    queryFn: async () => {
      const [companies, contacts, managers] = await Promise.allSettled([
        fetchBitrixCompanyNames(relatedIds.companyIds),
        fetchBitrixContactNames(relatedIds.contactIds),
        fetchBitrixUserNames(relatedIds.managerIds),
      ]);
      return {
        companyNames: companies.status === "fulfilled" ? companies.value : new Map<string, string>(),
        contactNames: contacts.status === "fulfilled" ? contacts.value : new Map<string, string>(),
        managerNames: managers.status === "fulfilled" ? managers.value : new Map<string, string>(),
      };
    },
    enabled: isInsideBitrix() && deals.length > 0,
    staleTime: 5 * 60_000,
  });

  const companyNames = relatedQuery.data?.companyNames ?? new Map<string, string>();
  const contactNames = relatedQuery.data?.contactNames ?? new Map<string, string>();
  const managerNames = relatedQuery.data?.managerNames ?? new Map<string, string>();

  const rows = useMemo(() => {
    return deals.map((deal) => {
      const r = deal as Record<string, unknown>;
      const stageId = String(r.STAGE_ID ?? r.stageId ?? "");
      const stageTitle = stageId ? titleById.get(stageId) : undefined;
      const budgetRaw =
        r.OPPORTUNITY !== undefined && r.OPPORTUNITY !== null && r.OPPORTUNITY !== ""
          ? r.OPPORTUNITY
          : r.opportunity !== undefined && r.opportunity !== null && r.opportunity !== ""
            ? r.opportunity
            : r.OPPORTUNITY_ACCOUNT;
      const assignedById = String(r.ASSIGNED_BY_ID ?? r.assignedById ?? "").trim();
      return {
        id: String(r.ID ?? r.id ?? ""),
        title: String(r.TITLE ?? r.title ?? ""),
        stageId,
        stageTitle,
        stageSort: stageById.get(stageId)?.sort,
        opportunity: budgetRaw !== undefined && budgetRaw !== null && budgetRaw !== "" ? String(budgetRaw) : undefined,
        budgetValue: Number.isFinite(Number(budgetRaw)) ? Number(budgetRaw) : undefined,
        currencyId: r.CURRENCY_ID
          ? String(r.CURRENCY_ID)
          : r.currencyId
            ? String(r.currencyId)
            : r.ACCOUNT_CURRENCY_ID
              ? String(r.ACCOUNT_CURRENCY_ID)
              : undefined,
        client: dealClientTitle(r, companyNames, contactNames, relatedQuery.isFetching),
        manager: assignedById
          ? managerNames.get(assignedById) ?? (relatedQuery.isFetching ? "Загрузка…" : "Имя недоступно")
          : "Не указан",
      };
    });
  }, [deals, titleById, stageById, companyNames, contactNames, managerNames, relatedQuery.isFetching]);

  const sortedRows = useMemo(
    () => sort ? sortDealTableRows(rows, sort.key, sort.direction) : rows,
    [rows, sort],
  );

  const changeSort = (key: DealTableSortKey) => {
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  return (
    <Card data-testid="card-exhibition-deals">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Сделки выставки</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{expoTitle}</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium tabular-nums">
          {rows.length}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            Для этой выставки сделок пока нет.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[760px] text-sm"
              data-testid="exhibition-deals-table"
            >
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <SortableHeader label="Сделка" sortKey="title" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Клиент" sortKey="client" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Стадия" sortKey="stage" sort={sort} onSort={changeSort} />
                  <SortableHeader label="Бюджет" sortKey="budget" sort={sort} onSort={changeSort} align="right" />
                  <SortableHeader label="Ответственный" sortKey="manager" sort={sort} onSort={changeSort} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const stageColor = stageDisplayColor(
                    row.stageId,
                    row.stageTitle,
                    colorById.get(row.stageId),
                  );
                  return (
                    <tr
                      key={row.id}
                      className="border-b align-middle transition-colors last:border-0 hover:bg-muted/40"
                      data-testid={`exhibition-deal-row-${row.id}`}
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          className="text-left font-medium text-primary hover:underline"
                          onClick={() => openBitrixPath(`/crm/deal/details/${row.id}/`)}
                        >
                          {row.title || `Сделка #${row.id}`}
                        </button>
                        <div className="mt-0.5 text-xs text-muted-foreground">#{row.id}</div>
                      </td>
                      <td className="px-3 py-3">{row.client}</td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: stageColor }}
                            aria-hidden="true"
                          />
                          {row.stageTitle || "Стадия не указана"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">
                        {formatDealBudget(row.opportunity, row.currencyId)}
                      </td>
                      <td className="px-3 py-3">{row.manager}</td>
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

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: DealTableSortKey;
  sort: { key: DealTableSortKey; direction: SortDirection } | null;
  onSort: (key: DealTableSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={!active ? "none" : sort.direction === "asc" ? "ascending" : "descending"}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 rounded py-1 transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 ${align === "right" ? "flex-row-reverse" : ""}`}
        onClick={() => onSort(sortKey)}
        data-testid={`sort-deals-${sortKey}`}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </th>
  );
}
