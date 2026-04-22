import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ExternalLink, FileWarning, Loader2, Moon, RefreshCw, Save, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Route, Router, Switch, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import NotFound from "@/pages/not-found";
import {
  callBx,
  currentHandlerUrl,
  getPlacementEntityId,
  getPlacementInfo,
  initBitrix,
  isInsideBitrix,
  openBitrixPath,
  CrmItem,
} from "./lib/bitrix";
import {
  detectExpoModel,
  ExpoDetection,
  getDeal,
  getItem,
  listDealsByExpo,
  listExpoItems,
  listLeadsByExpo,
  updateCrmItem,
  updateDeal,
} from "./lib/expo-model";

type Theme = "light" | "dark";

const standardExpoFields = [
  "title",
  "assignedById",
  "opened",
  "begindate",
  "closedate",
  "comments",
  "opportunity",
  "currencyId",
];

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return {
    theme,
    toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}

function useBitrixReady() {
  return useQuery({
    queryKey: ["bitrix-ready"],
    queryFn: async () => {
      await initBitrix();
      return { inside: isInsideBitrix(), placement: getPlacementInfo() };
    },
  });
}

function useRouteQueryId() {
  const readId = () => {
    const fromSearch = new URLSearchParams(window.location.search).get("id");
    if (fromSearch) return fromSearch;
    const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
    return new URLSearchParams(hashQuery).get("id") ?? undefined;
  };
  const [id, setId] = useState<string | undefined>(() => readId());

  useEffect(() => {
    const update = () => setId(readId());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);

  return id;
}

function bitrixLocationHook(): [string, (to: string) => void] {
  const normalize = () => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash.startsWith("/")) return hash.split("?")[0] || "/";
    const path = window.location.pathname.match(/\/(install|deal-tab|expo-tab|calendar)\/?$/)?.[1];
    return path ? `/${path}` : "/";
  };

  const [location, setLocationState] = useState(normalize);

  useEffect(() => {
    const update = () => setLocationState(normalize());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  const navigate = (to: string) => {
    window.location.hash = to.startsWith("/") ? to : `/${to}`;
    setLocationState(to.startsWith("/") ? to : `/${to}`);
  };

  return [location, navigate];
}

function useDetection() {
  return useQuery({
    queryKey: ["expo-detection"],
    queryFn: detectExpoModel,
    enabled: isInsideBitrix(),
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="text-sm font-semibold leading-none" data-testid="text-app-name">
                Календарь выставок
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-company-name">
                interpro.pro · Bitrix24 CRM
              </div>
            </div>
          </div>
          <nav className="hidden items-center gap-2 md:flex" aria-label="Основная навигация">
            <NavLink href="/install">Установка</NavLink>
            <NavLink href="/deal-tab">Сделка</NavLink>
            <NavLink href="/expo-tab">Выставка</NavLink>
            <NavLink href="/calendar">Календарь</NavLink>
          </nav>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            aria-label="Переключить тему"
            data-testid="button-toggle-theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6" id="main-content">
        {children}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg
      aria-label="interpro expo"
      className="h-10 w-10 text-primary"
      viewBox="0 0 64 64"
      fill="none"
      data-testid="img-logo"
    >
      <rect x="7" y="9" width="50" height="46" rx="12" stroke="currentColor" strokeWidth="4" />
      <path d="M18 24h28M18 34h28M18 44h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M24 14v36M42 14v28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href}>
      <a className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" data-testid={`link-${href.slice(1)}`}>
        {children}
      </a>
    </Link>
  );
}

function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 grid gap-2">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary" data-testid="text-page-eyebrow">
        {eyebrow}
      </div>
      <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
        {title}
      </h1>
      <p className="max-w-3xl text-sm text-muted-foreground" data-testid="text-page-description">
        {description}
      </p>
    </div>
  );
}

function StatusCard({ ready, detection }: { ready?: { inside: boolean }; detection?: ExpoDetection }) {
  return (
    <Card className="mb-6">
      <CardContent className="grid gap-3 p-4 md:grid-cols-4">
        <StatusPill label="BX24 SDK" value={ready?.inside ? "доступен" : "демо-режим"} ok={Boolean(ready?.inside)} />
        <StatusPill
          label="Смарт-процесс"
          value={detection?.expoType ? `${detection.expoType.title} · ${detection.expoType.entityTypeId}` : "не определён"}
          ok={Boolean(detection?.expoType)}
        />
        <StatusPill label="Связь сделок" value={detection?.dealExpoField?.code ?? "не найдена"} ok={Boolean(detection?.dealExpoField)} />
        <StatusPill label="Связь лидов" value={detection?.leadExpoField?.code ?? "не найдена"} ok={Boolean(detection?.leadExpoField)} />
      </CardContent>
    </Card>
  );
}

function StatusPill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3" data-testid={`status-${label}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-sm font-medium">
        <span className={ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>
          {ok ? "●" : "●"}
        </span>
        <span>{value}</span>
      </div>
    </div>
  );
}

function InstallPage() {
  const ready = useBitrixReady();
  const detection = useDetection();
  const { toast } = useToast();
  const [manualEntityTypeId, setManualEntityTypeId] = useState("");
  const entityTypeId = detection.data?.expoType?.entityTypeId ?? (Number(manualEntityTypeId) || undefined);

  const install = useMutation({
    mutationFn: async () => {
      if (!entityTypeId) throw new Error("Не найден entityTypeId смарт-процесса “Выставки”.");
      const dynamicPlacement = `CRM_DYNAMIC_${entityTypeId}_DETAIL_TAB`;
      const calls: Record<string, [string, Record<string, unknown>]> = {
        deal_tab: [
          "placement.bind",
          {
            PLACEMENT: "CRM_DEAL_DETAIL_TAB",
            HANDLER: currentHandlerUrl("/deal-tab"),
            TITLE: "Выставка",
            DESCRIPTION: "Связанная выставка, даты и сделки",
            GROUP_NAME: "interpro.pro",
          },
        ],
        expo_tab: [
          "placement.bind",
          {
            PLACEMENT: dynamicPlacement,
            HANDLER: currentHandlerUrl("/expo-tab"),
            TITLE: "Работы и результаты",
            DESCRIPTION: "Карточка выставки, сделки, лиды и итоги",
            GROUP_NAME: "interpro.pro",
          },
        ],
        calendar_menu: [
          "placement.bind",
          {
            PLACEMENT: "CRM_ANALYTICS_MENU",
            HANDLER: currentHandlerUrl("/calendar"),
            TITLE: "Календарь выставок",
            DESCRIPTION: "Календарный обзор выставок interpro.pro",
            GROUP_NAME: "interpro.pro",
          },
        ],
      };

      await new Promise<void>((resolve, reject) => {
        if (!window.BX24) {
          reject(new Error("Откройте страницу установки внутри Bitrix24."));
          return;
        }
        window.BX24.callBatch(calls, (results) => {
          const failed = Object.entries(results).filter(([, result]) => result.error());
          if (failed.length) {
            reject(
              new Error(
                failed
                  .map(([key, result]) => `${key}: ${result.error()} ${result.error_description() ?? ""}`)
                  .join("; "),
              ),
            );
            return;
          }
          window.BX24?.installFinish();
          resolve();
        });
      });

      return { dynamicPlacement };
    },
    onSuccess: (data) => {
      toast({
        title: "Установка завершена",
        description: `Зарегистрированы CRM_DEAL_DETAIL_TAB, ${data.dynamicPlacement}, CRM_ANALYTICS_MENU.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Установка не завершена",
        description: error instanceof Error ? error.message : "Проверьте права администратора и entityTypeId.",
        variant: "destructive",
      });
    },
  });

  return (
    <Shell>
      <PageTitle
        eyebrow="Установка"
        title="Регистрация приложения в Bitrix24"
        description="Страница установки определяет смарт-процесс “Выставки”, регистрирует placement’ы через placement.bind и после успешного batch-вызова завершает установку BX24.installFinish()."
      />
      <StatusCard ready={ready.data} detection={detection.data} />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Действия установки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ready.data?.inside && (
              <Notice
                tone="warning"
                title="Открыто вне Bitrix24"
                text="Кнопка установки сработает только в iframe установки локального приложения Bitrix24, где доступен BX24 SDK и OAuth-контекст."
              />
            )}
            {!detection.data?.expoType && (
              <div className="grid gap-2">
                <Label htmlFor="manual-entity-type-id">entityTypeId выставок вручную</Label>
                <Input
                  id="manual-entity-type-id"
                  data-testid="input-manual-entity-type-id"
                  value={manualEntityTypeId}
                  onChange={(event) => setManualEntityTypeId(event.target.value)}
                  placeholder="Например: 183"
                />
              </div>
            )}
            <div className="grid gap-2 rounded-lg bg-muted/50 p-4 text-sm">
              <div className="font-medium">Будут зарегистрированы:</div>
              <CodeLine value="CRM_DEAL_DETAIL_TAB → /deal-tab" />
              <CodeLine value={`CRM_DYNAMIC_${entityTypeId ?? "XXX"}_DETAIL_TAB → /expo-tab`} />
              <CodeLine value="CRM_ANALYTICS_MENU → /calendar" />
            </div>
            <Button
              onClick={() => install.mutate()}
              disabled={install.isPending || !ready.data?.inside}
              data-testid="button-install"
              className="w-full sm:w-auto"
            >
              {install.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Зарегистрировать и завершить установку
            </Button>
          </CardContent>
        </Card>

        <DiagnosticsPanel detection={detection.data} loading={detection.isLoading} />
      </div>
    </Shell>
  );
}

function DiagnosticsPanel({ detection, loading }: { detection?: ExpoDetection; loading?: boolean }) {
  if (loading) {
    return <SkeletonCard title="Диагностика полей" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Зафиксированные поля</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldLine label="entityTypeId" value={detection?.expoType?.entityTypeId} />
        <FieldLine label="Сделка → выставка" value={detection?.dealExpoField?.code} />
        <FieldLine label="Лид → выставка" value={detection?.leadExpoField?.code} />
        <Separator />
        <FieldLine label="Монтаж начало" value={detection?.dateFields.mountStart?.code} />
        <FieldLine label="Проведение начало" value={detection?.dateFields.eventStart?.code} />
        <FieldLine label="Проведение окончание" value={detection?.dateFields.eventEnd?.code} />
        <FieldLine label="Демонтаж окончание" value={detection?.dateFields.dismantleEnd?.code} />
        <Separator />
        <div>
          <div className="mb-2 text-sm font-medium">Итоговые поля</div>
          <div className="flex flex-wrap gap-2">
            {detection?.resultFields.length ? (
              detection.resultFields.map((field) => (
                <Badge key={field.code} variant="secondary" data-testid={`badge-result-field-${field.code}`}>
                  {field.code}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Не определены автоматически</span>
            )}
          </div>
        </div>
        {detection?.notes.length ? (
          <Notice tone="warning" title="Потребуется уточнение" text={detection.notes.join(" ")} />
        ) : (
          <Notice tone="success" title="Автодиагностика завершена" text="Основные поля найдены по метаданным CRM." />
        )}
      </CardContent>
    </Card>
  );
}

function DealTabPage() {
  const ready = useBitrixReady();
  const detection = useDetection();
  const placement = ready.data?.placement;
  const placementDealId = getPlacementEntityId(placement ?? {});
  const queryDealId = useRouteQueryId();
  const [manualDealId, setManualDealId] = useState("");
  const dealId = placementDealId ?? queryDealId ?? manualDealId;
  const { toast } = useToast();

  const deal = useQuery({
    queryKey: ["deal", dealId],
    queryFn: () => getDeal(dealId),
    enabled: isInsideBitrix() && Boolean(dealId),
  });

  const expoId = useMemo(() => {
    const field = detection.data?.dealExpoField?.code;
    if (!field || !deal.data) return undefined;
    const value = deal.data[field] ?? deal.data[field.toUpperCase()];
    return Array.isArray(value) ? value[0] : value;
  }, [deal.data, detection.data?.dealExpoField?.code]);

  const expo = useQuery({
    queryKey: ["expo-from-deal", detection.data?.expoType?.entityTypeId, expoId],
    queryFn: () => getItem(detection.data!.expoType!.entityTypeId, String(expoId)),
    enabled: isInsideBitrix() && Boolean(detection.data?.expoType && expoId),
  });

  const relatedDeals = useQuery({
    queryKey: ["related-deals", expoId],
    queryFn: () => listDealsByExpo(detection.data!.dealExpoField!.code, String(expoId)),
    enabled: isInsideBitrix() && Boolean(detection.data?.dealExpoField && expoId),
  });

  const relatedLeads = useQuery({
    queryKey: ["related-leads", expoId],
    queryFn: () => listLeadsByExpo(detection.data!.leadExpoField!.code, String(expoId)),
    enabled: isInsideBitrix() && Boolean(detection.data?.leadExpoField && expoId),
  });

  const saveDeal = useMutation({
    mutationFn: (fields: Record<string, unknown>) => updateDeal(dealId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      toast({ title: "Сделка обновлена", description: "Изменения сохранены в Bitrix24." });
    },
    onError: (error) => toast({ title: "Ошибка сохранения", description: String(error), variant: "destructive" }),
  });

  return (
    <Shell>
      <PageTitle
        eyebrow="Вкладка сделки"
        title="Связанная выставка и CRM-объекты"
        description="Экран использует BX24.placement.info(), берёт ID сделки из контекста вкладки и показывает связанную выставку, даты, другие сделки и лиды."
      />
      <StatusCard ready={ready.data} detection={detection.data} />
      {!placementDealId && <ManualId label="ID сделки для теста" value={manualDealId} onChange={setManualDealId} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Сделка</CardTitle>
          </CardHeader>
          <CardContent>
            {deal.isLoading ? <LoadingRows /> : <ObjectDetails item={deal.data} fallback="Сделка не загружена" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Связанная выставка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {expo.isLoading ? <LoadingRows /> : <ExpoSummary expo={expo.data} detection={detection.data} />}
            {deal.data && detection.data?.dealExpoField && (
              <QuickFieldEditor
                title="Разрешённые поля сделки"
                fields={["TITLE", "COMMENTS", detection.data.dealExpoField.code].filter(Boolean)}
                item={deal.data}
                saving={saveDeal.isPending}
                onSave={(fields) => saveDeal.mutate(fields)}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <RelatedLists deals={relatedDeals.data} leads={relatedLeads.data} currentDealId={dealId} />
    </Shell>
  );
}

function ExpoTabPage() {
  const ready = useBitrixReady();
  const detection = useDetection();
  const placementExpoId = getPlacementEntityId(ready.data?.placement ?? {});
  const queryExpoId = useRouteQueryId();
  const [manualExpoId, setManualExpoId] = useState("");
  const expoId = placementExpoId ?? queryExpoId ?? manualExpoId;
  const { toast } = useToast();

  const expo = useQuery({
    queryKey: ["expo", detection.data?.expoType?.entityTypeId, expoId],
    queryFn: () => getItem(detection.data!.expoType!.entityTypeId, expoId),
    enabled: isInsideBitrix() && Boolean(detection.data?.expoType && expoId),
  });

  const relatedDeals = useQuery({
    queryKey: ["expo-deals", expoId],
    queryFn: () => listDealsByExpo(detection.data!.dealExpoField!.code, expoId),
    enabled: isInsideBitrix() && Boolean(detection.data?.dealExpoField && expoId),
  });

  const relatedLeads = useQuery({
    queryKey: ["expo-leads", expoId],
    queryFn: () => listLeadsByExpo(detection.data!.leadExpoField!.code, expoId),
    enabled: isInsideBitrix() && Boolean(detection.data?.leadExpoField && expoId),
  });

  const saveExpo = useMutation({
    mutationFn: (fields: Record<string, unknown>) => updateCrmItem(detection.data!.expoType!.entityTypeId, expoId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expo", detection.data?.expoType?.entityTypeId, expoId] });
      toast({ title: "Выставка обновлена", description: "Поля сохранены через crm.item.update." });
    },
    onError: (error) => toast({ title: "Ошибка сохранения", description: String(error), variant: "destructive" }),
  });

  const editableFields = useMemo(() => {
    const detected = detection.data?.editableExpoFields.map((field) => field.code) ?? [];
    const results = detection.data?.resultFields.map((field) => field.code) ?? [];
    return Array.from(new Set([...standardExpoFields, ...detected, ...results]));
  }, [detection.data]);

  return (
    <Shell>
      <PageTitle
        eyebrow="Вкладка выставки"
        title="Карточка выставки, работы и итоги"
        description="Экран получает ID элемента смарт-процесса из placement.info(), показывает карточку, связанные лиды/сделки и сохраняет разрешённые поля через crm.item.update."
      />
      <StatusCard ready={ready.data} detection={detection.data} />
      {!placementExpoId && <ManualId label="ID выставки для теста" value={manualExpoId} onChange={setManualExpoId} />}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Полная карточка выставки</CardTitle>
          </CardHeader>
          <CardContent>
            {expo.isLoading ? <LoadingRows /> : <ObjectDetails item={expo.data} fallback="Выставка не загружена" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Редактирование</CardTitle>
          </CardHeader>
          <CardContent>
            {expo.data ? (
              <QuickFieldEditor
                title="Поля выставки и итоговые поля"
                fields={editableFields}
                item={expo.data}
                saving={saveExpo.isPending}
                onSave={(fields) => saveExpo.mutate(fields)}
              />
            ) : (
              <Empty text="Откройте вкладку из карточки выставки или укажите ID для теста." />
            )}
          </CardContent>
        </Card>
      </div>

      <ResultsSummary expo={expo.data} detection={detection.data} />
      <RelatedLists deals={relatedDeals.data} leads={relatedLeads.data} />
    </Shell>
  );
}

function CalendarPage() {
  const ready = useBitrixReady();
  const detection = useDetection();
  const [selectedExpoId, setSelectedExpoId] = useState<string | number | undefined>();

  const expos = useQuery({
    queryKey: ["expo-calendar", detection.data?.expoType?.entityTypeId],
    queryFn: () => listExpoItems(detection.data!.expoType!.entityTypeId),
    enabled: isInsideBitrix() && Boolean(detection.data?.expoType),
  });

  const selectedExpo = expos.data?.find((expo) => String(expo.id) === String(selectedExpoId)) ?? expos.data?.[0];

  const relatedDeals = useQuery({
    queryKey: ["calendar-deals", selectedExpo?.id],
    queryFn: () => listDealsByExpo(detection.data!.dealExpoField!.code, String(selectedExpo!.id)),
    enabled: isInsideBitrix() && Boolean(detection.data?.dealExpoField && selectedExpo?.id),
  });

  const relatedLeads = useQuery({
    queryKey: ["calendar-leads", selectedExpo?.id],
    queryFn: () => listLeadsByExpo(detection.data!.leadExpoField!.code, String(selectedExpo!.id)),
    enabled: isInsideBitrix() && Boolean(detection.data?.leadExpoField && selectedExpo?.id),
  });

  return (
    <Shell>
      <PageTitle
        eyebrow="Календарь"
        title="Календарь выставок"
        description="Все выставки отображаются на временной сетке: монтаж, проведение и демонтаж выделены разными состояниями. По клику открывается панель с данными и переходами в Bitrix24."
      />
      <StatusCard ready={ready.data} detection={detection.data} />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">План выставок</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["expo-calendar"] })}
              data-testid="button-refresh-calendar"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
          </CardHeader>
          <CardContent>
            {expos.isLoading ? (
              <LoadingRows />
            ) : (
              <ExpoTimeline
                expos={expos.data ?? []}
                detection={detection.data}
                selectedId={selectedExpo?.id}
                onSelect={setSelectedExpoId}
              />
            )}
          </CardContent>
        </Card>

        <Card className="xl:sticky xl:top-24 xl:self-start">
          <CardHeader>
            <CardTitle className="text-lg">Панель выставки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExpoSummary expo={selectedExpo} detection={detection.data} />
            {selectedExpo?.id && detection.data?.expoType && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openBitrixPath(`/crm/type/${detection.data!.expoType!.entityTypeId}/details/${selectedExpo.id}/`)}
                  data-testid="button-open-expo-card"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Карточка Bitrix24
                </Button>
                <Link href={`/expo-tab?id=${selectedExpo.id}`}>
                  <a className="inline-flex h-9 items-center rounded-md border px-3 text-sm" data-testid="link-open-expo-tab">
                    Вкладка приложения
                  </a>
                </Link>
              </div>
            )}
            <RelatedLists compact deals={relatedDeals.data} leads={relatedLeads.data} />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function ExpoTimeline({
  expos,
  detection,
  selectedId,
  onSelect,
}: {
  expos: CrmItem[];
  detection?: ExpoDetection;
  selectedId?: string | number;
  onSelect: (id?: string | number) => void;
}) {
  if (!expos.length) return <Empty text="Выставки не найдены или у пользователя нет прав на чтение." />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_2fr] gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Выставка</span>
        <span>Этапы</span>
      </div>
      {expos.map((expo) => {
        const id = expo.id ?? "";
        return (
          <button
            key={String(id)}
            onClick={() => onSelect(id)}
            className={`grid w-full grid-cols-[1fr_2fr] gap-3 rounded-xl border p-3 text-left transition hover:bg-accent ${
              String(id) === String(selectedId) ? "border-primary bg-primary/5" : "bg-card"
            }`}
            data-testid={`button-select-expo-${id}`}
          >
            <div>
              <div className="font-medium">{String(expo.title ?? `Выставка #${id}`)}</div>
              <div className="text-xs text-muted-foreground">ID {String(id)}</div>
            </div>
            <div className="grid gap-2">
              <TimelineSegment label="Монтаж" tone="mount" value={formatRange(getDate(expo, detection?.dateFields.mountStart?.code), getDate(expo, detection?.dateFields.eventStart?.code))} />
              <TimelineSegment label="Проведение" tone="event" value={formatRange(getDate(expo, detection?.dateFields.eventStart?.code), getDate(expo, detection?.dateFields.eventEnd?.code))} />
              <TimelineSegment label="Демонтаж" tone="dismantle" value={formatRange(getDate(expo, detection?.dateFields.eventEnd?.code), getDate(expo, detection?.dateFields.dismantleEnd?.code))} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TimelineSegment({ label, value, tone }: { label: string; value: string; tone: "mount" | "event" | "dismantle" }) {
  const color = tone === "mount" ? "bg-amber-500" : tone === "event" ? "bg-primary" : "bg-sky-600";
  return (
    <div className="grid grid-cols-[86px_1fr] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`h-2.5 w-16 rounded-full ${color}`} />
        <span>{value}</span>
      </span>
    </div>
  );
}

function RelatedLists({
  deals,
  leads,
  currentDealId,
  compact,
}: {
  deals?: CrmItem[];
  leads?: CrmItem[];
  currentDealId?: string;
  compact?: boolean;
}) {
  return (
    <div className={`mt-6 grid gap-6 ${compact ? "" : "lg:grid-cols-2"}`}>
      <EntityList title="Связанные сделки" type="deal" rows={deals} currentId={currentDealId} />
      <EntityList title="Связанные лиды" type="lead" rows={leads} />
    </div>
  );
}

function EntityList({ title, rows, type, currentId }: { title: string; rows?: CrmItem[]; type: "deal" | "lead"; currentId?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {title} <span className="text-muted-foreground">({rows?.length ?? 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!rows?.length ? (
          <Empty text="Связанные элементы не найдены." />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const id = String(row.ID ?? row.id ?? "");
              return (
                <div key={id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3" data-testid={`row-${type}-${id}`}>
                  <div>
                    <div className="font-medium">
                      {String(row.TITLE ?? row.title ?? `${type} #${id}`)}
                      {currentId && String(currentId) === id ? <Badge className="ml-2">текущая</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">ID {id}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openBitrixPath(type === "deal" ? `/crm/deal/details/${id}/` : `/crm/lead/details/${id}/`)}
                    data-testid={`button-open-${type}-${id}`}
                  >
                    Открыть
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultsSummary({ expo, detection }: { expo?: CrmItem; detection?: ExpoDetection }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-lg">Результаты работ по выставке</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {detection?.resultFields.length ? (
          detection.resultFields.map((field) => (
            <div key={field.code} className="rounded-lg border bg-card p-3" data-testid={`result-${field.code}`}>
              <div className="text-xs text-muted-foreground">{field.title}</div>
              <div className="mt-1 font-medium">{formatValue(expo?.[field.code])}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{field.code}</div>
            </div>
          ))
        ) : (
          <Empty text="Итоговые поля не найдены автоматически. Добавьте в смарт-процесс поля с названиями “Итог”, “Результат”, “Выручка”, “Количество лидов/сделок” или укажите коды вручную." />
        )}
      </CardContent>
    </Card>
  );
}

function ExpoSummary({ expo, detection }: { expo?: CrmItem; detection?: ExpoDetection }) {
  if (!expo) return <Empty text="Выставка не определена." />;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted-foreground">Название</div>
        <div className="text-lg font-semibold" data-testid="text-expo-title">
          {String(expo.title ?? "Без названия")}
        </div>
      </div>
      <div className="grid gap-2 text-sm">
        <FieldLine label="ID" value={expo.id} />
        <FieldLine label="Монтаж" value={formatValue(getDate(expo, detection?.dateFields.mountStart?.code))} />
        <FieldLine label="Начало проведения" value={formatValue(getDate(expo, detection?.dateFields.eventStart?.code))} />
        <FieldLine label="Окончание проведения" value={formatValue(getDate(expo, detection?.dateFields.eventEnd?.code))} />
        <FieldLine label="Демонтаж" value={formatValue(getDate(expo, detection?.dateFields.dismantleEnd?.code))} />
      </div>
    </div>
  );
}

function QuickFieldEditor({
  title,
  fields,
  item,
  saving,
  onSave,
}: {
  title: string;
  fields: string[];
  item: CrmItem;
  saving?: boolean;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const visibleFields = fields.filter((field) => field && Object.prototype.hasOwnProperty.call(item, field));
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    visibleFields.forEach((field) => {
      const value = item[field];
      next[field] = Array.isArray(value) ? value.join(",") : value === undefined || value === null ? "" : String(value);
    });
    setValues(next);
  }, [item, visibleFields.join("|")]);

  if (!visibleFields.length) return <Empty text="Разрешённые поля для редактирования не найдены в ответе CRM." />;

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{title}</div>
      {visibleFields.slice(0, 8).map((field) => (
        <div key={field} className="grid gap-1.5">
          <Label htmlFor={`field-${field}`}>{field}</Label>
          <Input
            id={`field-${field}`}
            value={values[field] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
            data-testid={`input-field-${field}`}
          />
        </div>
      ))}
      <Button onClick={() => onSave(values)} disabled={saving} data-testid="button-save-fields">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Сохранить в Bitrix24
      </Button>
    </div>
  );
}

function ObjectDetails({ item, fallback }: { item?: CrmItem; fallback: string }) {
  if (!item) return <Empty text={fallback} />;
  const entries = Object.entries(item).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b last:border-0" data-testid={`row-field-${key}`}>
              <td className="w-56 bg-muted/50 px-3 py-2 font-medium text-muted-foreground">{key}</td>
              <td className="px-3 py-2">{formatValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManualId({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Card className="mb-6">
      <CardContent className="grid gap-2 p-4 sm:max-w-sm">
        <Label htmlFor="manual-id">{label}</Label>
        <Input id="manual-id" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Введите ID" data-testid="input-manual-id" />
      </CardContent>
    </Card>
  );
}

function Notice({ tone, title, text }: { tone: "warning" | "success"; title: string; text: string }) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" : "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      }`}
      data-testid={`notice-${tone}`}
    >
      <div className="flex items-center gap-2 font-medium">
        {tone === "warning" ? <FileWarning className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {title}
      </div>
      <div className="mt-1 opacity-90">{text}</div>
    </div>
  );
}

function FieldLine({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm" data-testid={`fieldline-${label}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{formatValue(value)}</span>
    </div>
  );
}

function CodeLine({ value }: { value: string }) {
  return <code className="rounded bg-background px-2 py-1 text-xs" data-testid={`code-${value}`}>{value}</code>;
}

function SkeletonCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <LoadingRows />
      </CardContent>
    </Card>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3" data-testid="status-loading">
      <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-5 w-5/6 animate-pulse rounded bg-muted" />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="status-empty">
      <CalendarDays className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
      {text}
    </div>
  );
}

function getDate(item?: CrmItem, code?: string) {
  if (!item || !code) return undefined;
  return item[code] ?? item[code.toUpperCase()] ?? item[code.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
}

function formatRange(from: unknown, to: unknown) {
  const start = formatValue(from);
  const end = formatValue(to);
  if (start === "—" && end === "—") return "даты не указаны";
  if (start === end) return start;
  return `${start} → ${end}`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("ru-RU");
    }
  }
  return text;
}

function HomePage() {
  return (
    <Shell>
      <PageTitle
        eyebrow="Прототип"
        title="Внешнее приложение Bitrix24 для выставок"
        description="Откройте страницу установки в Bitrix24, чтобы зарегистрировать вкладки сделки, вкладку смарт-процесса “Выставки” и отдельный экран календаря."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <LinkCard href="/install" title="Установка" text="placement.bind и BX24.installFinish()." />
        <LinkCard href="/deal-tab" title="Вкладка сделки" text="Связанная выставка, даты, сделки и лиды." />
        <LinkCard href="/calendar" title="Календарь" text="Монтаж, проведение, демонтаж и панель деталей." />
      </div>
    </Shell>
  );
}

function LinkCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href}>
      <a className="block rounded-xl border bg-card p-5 transition hover:bg-accent" data-testid={`link-card-${href.slice(1)}`}>
        <div className="font-semibold">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">{text}</div>
      </a>
    </Link>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/install" component={InstallPage} />
      <Route path="/deal-tab" component={DealTabPage} />
      <Route path="/expo-tab" component={ExpoTabPage} />
      <Route path="/calendar" component={CalendarPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={bitrixLocationHook}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
