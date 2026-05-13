import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileWarning, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Shell, PageTitle, Empty } from "./shell";
import {
  callBxRaw,
  currentHandlerUrl,
  findStaleHandlers,
  getManagedPlacements,
  initBitrix,
  isAlreadyBoundError,
  isInsideBitrix,
  listRegisteredPlacements,
  RegisteredHandler,
} from "@/lib/bitrix";
import {
  EXPO_ENTITY_TYPE_ID,
  leadExpoFieldCode,
  dealExpoFieldCode,
  leadExpoFieldFormat,
  dealExpoFieldFormat,
  ExpoLinkFormatOverride,
} from "@/lib/config";
import { discoverLinkFields, LinkDiscoveryResult, LinkFieldCandidate, summarizeSettings } from "@/lib/expo-link";
import { useToast } from "@/hooks/use-toast";

type InstallTargetHandler = {
  placement: string;
  handler: string;
  title: string;
  description: string;
};

type VerifyEntry = {
  placement: string;
  expectedHandler: string;
  found: boolean;
  actualHandler?: string;
  message?: string;
};

type InstallDiagnostics = {
  origin: string;
  registered: RegisteredHandler[];
  registeredError?: string;
  stale: RegisteredHandler[];
  unbound: { placement: string; handler: string; ok: boolean; message?: string }[];
  bound: { placement: string; handler: string; ok: boolean; alreadyBound: boolean; message?: string }[];
  targets: InstallTargetHandler[];
  verified: VerifyEntry[];
  errors: string[];
  finished: boolean;
};

type CheckDiagnostics = {
  origin: string;
  registered: RegisteredHandler[];
  managedRows: RegisteredHandler[];
  errorMessage?: string;
  ranAt: string;
};

const YANDEX_HOST_MARKER = "containers.yandexcloud.net";
const RENDER_HOST_MARKER = "onrender.com";

function classifyHost(handler: string, currentOrigin: string): { label: string; tone: "ok" | "stale" | "neutral" } {
  if (!handler) return { label: "—", tone: "neutral" };
  let url: URL;
  try {
    url = new URL(handler);
  } catch {
    return { label: "невалидный URL", tone: "stale" };
  }
  const host = url.host.toLowerCase();
  if (currentOrigin && url.origin === currentOrigin) return { label: `current (${host})`, tone: "ok" };
  if (host.includes(YANDEX_HOST_MARKER)) return { label: `Yandex (${host})`, tone: "ok" };
  if (host.includes(RENDER_HOST_MARKER)) return { label: `Render-legacy (${host})`, tone: "stale" };
  return { label: host, tone: "neutral" };
}

export default function InstallPage() {
  const ready = useQuery({
    queryKey: ["bitrix-ready"],
    queryFn: async () => {
      await initBitrix();
      return { inside: isInsideBitrix() };
    },
  });
  const { toast } = useToast();
  const [manualEntityTypeId, setManualEntityTypeId] = useState(String(EXPO_ENTITY_TYPE_ID));
  const [installStatus, setInstallStatus] = useState<{ tone: "success" | "warning"; title: string; text: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<InstallDiagnostics | null>(null);
  const [checkStatus, setCheckStatus] = useState<{ tone: "success" | "warning"; title: string; text: string } | null>(null);
  const [checkDiagnostics, setCheckDiagnostics] = useState<CheckDiagnostics | null>(null);
  const entityTypeId = Number(manualEntityTypeId) || EXPO_ENTITY_TYPE_ID;

  const install = useMutation({
    mutationFn: async () => {
      if (!window.BX24) throw new Error("Откройте страницу установки внутри Bitrix24.");
      if (!entityTypeId) throw new Error("entityTypeId не задан.");

      const dynamicPlacement = `CRM_DYNAMIC_${entityTypeId}_DETAIL_TAB`;
      const origin = window.location.origin;
      const targets: InstallTargetHandler[] = [
        {
          placement: "CRM_DEAL_DETAIL_TAB",
          handler: currentHandlerUrl("/deal-tab"),
          title: "Выставка · аналитика",
          description: "Воронки лидов/сделок по связанной выставке",
        },
        {
          placement: "CRM_LEAD_DETAIL_TAB",
          handler: currentHandlerUrl("/lead-tab"),
          title: "Выставка · аналитика",
          description: "Воронки лидов/сделок по связанной выставке",
        },
        {
          placement: dynamicPlacement,
          handler: currentHandlerUrl("/expo-tab"),
          title: "Работы и результаты",
          description: "Карточка выставки, связанные лиды/сделки",
        },
        {
          placement: dynamicPlacement,
          handler: currentHandlerUrl("/placement-detail"),
          title: "Источник данных",
          description: "URL организатора, проверить сейчас",
        },
        {
          placement: "CRM_ANALYTICS_MENU",
          handler: currentHandlerUrl("/calendar"),
          title: "Календарь выставок",
          description: "Календарь выставок interpro.pro",
        },
        {
          placement: `CRM_DYNAMIC_${entityTypeId}_LIST_MENU`,
          handler: currentHandlerUrl("/placement-list"),
          title: "Добавить по ссылке",
          description: "Smart enrichment: создание выставки по URL организатора",
        },
        {
          placement: "LEFT_MENU",
          handler: currentHandlerUrl("/placement-menu"),
          title: "Календарь выставок",
          description: "Календарь выставок interpro.pro: добавить, проверить",
        },
      ];

      const diag: InstallDiagnostics = {
        origin,
        registered: [],
        stale: [],
        unbound: [],
        bound: [],
        targets,
        verified: [],
        errors: [],
        finished: false,
      };

      try {
        diag.registered = await listRegisteredPlacements();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        diag.registeredError = msg;
        diag.errors.push(`placement.get: ${msg}`);
      }
      setDiagnostics({ ...diag });

      const managedPlacements = getManagedPlacements(entityTypeId);
      diag.stale = findStaleHandlers(diag.registered, managedPlacements, origin);
      setDiagnostics({ ...diag });

      for (const stale of diag.stale) {
        try {
          const result = await callBxRaw("placement.unbind", {
            PLACEMENT: stale.placement,
            HANDLER: stale.handler,
          });
          const err = result.error();
          if (err) {
            diag.unbound.push({ placement: stale.placement, handler: stale.handler, ok: false, message: `${err}: ${result.error_description() ?? ""}`.trim() });
            diag.errors.push(`unbind ${stale.placement}: ${err}`);
          } else {
            diag.unbound.push({ placement: stale.placement, handler: stale.handler, ok: true });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          diag.unbound.push({ placement: stale.placement, handler: stale.handler, ok: false, message: msg });
          diag.errors.push(`unbind ${stale.placement}: ${msg}`);
        }
        setDiagnostics({ ...diag });
      }

      for (const target of targets) {
        try {
          const result = await callBxRaw("placement.bind", {
            PLACEMENT: target.placement,
            HANDLER: target.handler,
            TITLE: target.title,
            DESCRIPTION: target.description,
            GROUP_NAME: "interpro.pro",
          });
          const err = result.error();
          const desc = result.error_description();
          if (err) {
            const already = isAlreadyBoundError(err, desc);
            diag.bound.push({
              placement: target.placement,
              handler: target.handler,
              ok: already,
              alreadyBound: already,
              message: `${err}: ${desc ?? ""}`.trim(),
            });
            if (!already) {
              diag.errors.push(`bind ${target.placement}: ${err} ${desc ?? ""}`.trim());
            }
          } else {
            diag.bound.push({ placement: target.placement, handler: target.handler, ok: true, alreadyBound: false });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          diag.bound.push({ placement: target.placement, handler: target.handler, ok: false, alreadyBound: false, message: msg });
          diag.errors.push(`bind ${target.placement}: ${msg}`);
        }
        setDiagnostics({ ...diag });
      }

      // Post-bind verification: re-query placement.get and match each target.
      let verifyRows: RegisteredHandler[] = [];
      try {
        verifyRows = await listRegisteredPlacements();
        diag.registered = verifyRows;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        diag.errors.push(`placement.get (verify): ${msg}`);
      }
      diag.verified = targets.map((target) => {
        const match = verifyRows.find(
          (row) => row.placement === target.placement && row.handler === target.handler,
        );
        if (match) {
          return { placement: target.placement, expectedHandler: target.handler, found: true, actualHandler: match.handler };
        }
        const samePlacement = verifyRows.find((row) => row.placement === target.placement);
        return {
          placement: target.placement,
          expectedHandler: target.handler,
          found: false,
          actualHandler: samePlacement?.handler,
          message: samePlacement
            ? "найден другой handler для этого placement"
            : "placement.get не вернул этот handler",
        };
      });
      setDiagnostics({ ...diag });

      const allBindsOk = diag.bound.every((entry) => entry.ok);
      const allVerifiedOk = diag.verified.every((v) => v.found);
      if (allBindsOk && allVerifiedOk) {
        try {
          window.BX24.installFinish();
          diag.finished = true;
        } catch (error) {
          diag.errors.push(`installFinish: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (allBindsOk && !allVerifiedOk) {
        diag.errors.push(
          `Не вызываем installFinish: placement.get не подтвердил ${diag.verified.filter((v) => !v.found).length} handler(ов).`,
        );
      }
      setDiagnostics({ ...diag });

      return { diag };
    },
    onSuccess: ({ diag }) => {
      if (diag.finished) {
        setInstallStatus({ tone: "success", title: "Установка завершена", text: "Все placement-ы Render-origin зарегистрированы. BX24.installFinish() вызван." });
        toast({ title: "Установка завершена" });
      } else {
        setInstallStatus({ tone: "warning", title: "Установка завершена с ошибками", text: diag.errors.join("; ") || "См. диагностику ниже." });
      }
    },
    onError: (error) => {
      setInstallStatus({ tone: "warning", title: "Установка не завершена", text: error instanceof Error ? error.message : String(error) });
    },
  });

  const check = useMutation({
    mutationFn: async (): Promise<CheckDiagnostics> => {
      if (!window.BX24) throw new Error("Откройте страницу внутри Bitrix24 — BX24 SDK недоступен.");
      const origin = window.location.origin;
      const managed = new Set(getManagedPlacements(entityTypeId));
      const ranAt = new Date().toISOString();
      try {
        const rows = await listRegisteredPlacements();
        const managedRows = rows.filter((row) => managed.has(row.placement));
        return { origin, registered: rows, managedRows, ranAt };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { origin, registered: [], managedRows: [], errorMessage: msg, ranAt };
      }
    },
    onSuccess: (data) => {
      setCheckDiagnostics(data);
      if (data.errorMessage) {
        setCheckStatus({ tone: "warning", title: "placement.get вернул ошибку", text: data.errorMessage });
      } else {
        const yandexCount = data.managedRows.filter((r) => r.handler.includes(YANDEX_HOST_MARKER)).length;
        const renderCount = data.managedRows.filter((r) => r.handler.includes(RENDER_HOST_MARKER)).length;
        setCheckStatus({
          tone: renderCount > 0 ? "warning" : "success",
          title: `placement.get: managed=${data.managedRows.length}`,
          text: `Yandex handlers: ${yandexCount}, Render-legacy: ${renderCount}, всего строк: ${data.registered.length}.`,
        });
      }
    },
    onError: (error) => {
      setCheckStatus({ tone: "warning", title: "Не удалось проверить placements", text: error instanceof Error ? error.message : String(error) });
    },
  });

  return (
    <Shell>
      <PageTitle
        eyebrow="Установка"
        title="Регистрация приложения в Bitrix24"
        description="Снимает устаревшие handlers (Replit/другой origin), регистрирует текущие Render-обработчики и вызывает BX24.installFinish()."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader><CardTitle className="text-lg">Действия</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!ready.data?.inside && (
              <Notice
                tone="warning"
                title="Открыто вне Bitrix24"
                text="BX24 SDK недоступен. Кнопки установки и проверки требуют контекста Bitrix24 (iframe приложения). Откройте страницу /install через карточку приложения внутри Bitrix24, чтобы placement.bind/get работали."
              />
            )}
            <div className="grid gap-2">
              <Label htmlFor="entity-type-id">entityTypeId смарт-процесса “Выставки”</Label>
              <Input
                id="entity-type-id"
                value={manualEntityTypeId}
                onChange={(e) => setManualEntityTypeId(e.target.value)}
                data-testid="input-entity-type-id"
              />
            </div>
            <div className="grid gap-2 rounded-lg bg-muted/50 p-4 text-sm">
              <div className="font-medium">Origin:</div>
              <code className="rounded bg-background px-2 py-1 text-xs">{typeof window !== "undefined" ? window.location.origin : "—"}</code>
              <div className="mt-2 font-medium">Будут зарегистрированы:</div>
              <code className="rounded bg-background px-2 py-1 text-xs">CRM_DEAL_DETAIL_TAB → /deal-tab</code>
              <code className="rounded bg-background px-2 py-1 text-xs">CRM_LEAD_DETAIL_TAB → /lead-tab</code>
              <code className="rounded bg-background px-2 py-1 text-xs">{`CRM_DYNAMIC_${entityTypeId}_DETAIL_TAB → /expo-tab`}</code>
              <code className="rounded bg-background px-2 py-1 text-xs">{`CRM_DYNAMIC_${entityTypeId}_DETAIL_TAB → /placement-detail`}</code>
              <code className="rounded bg-background px-2 py-1 text-xs">{`CRM_DYNAMIC_${entityTypeId}_LIST_MENU → /placement-list`}</code>
              <code className="rounded bg-background px-2 py-1 text-xs">CRM_ANALYTICS_MENU → /calendar</code>
              <code className="rounded bg-background px-2 py-1 text-xs">LEFT_MENU → /placement-menu</code>
            </div>
            {installStatus && <Notice tone={installStatus.tone} title={installStatus.title} text={installStatus.text} />}
            {checkStatus && <Notice tone={checkStatus.tone} title={checkStatus.title} text={checkStatus.text} />}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => install.mutate()} disabled={install.isPending || !ready.data?.inside} data-testid="button-install">
                {install.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Переустановить и завершить установку
              </Button>
              <Button
                variant="outline"
                onClick={() => check.mutate()}
                disabled={check.isPending || !ready.data?.inside}
                data-testid="button-check-placements"
              >
                {check.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Проверить placements
              </Button>
            </div>
          </CardContent>
        </Card>

        <DiagnosticsPanel diagnostics={diagnostics} entityTypeId={entityTypeId} />
      </div>
      <CheckPanel diagnostics={checkDiagnostics} entityTypeId={entityTypeId} />
      <LinkFieldsCard inside={Boolean(ready.data?.inside)} />
      <Card className="mt-6 border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
        <CardHeader>
          <CardTitle className="text-base">Как отличить вкладку приложения от встроенной</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            В карточке сделки/лида Bitrix24 сам автоматически создаёт вкладку со связанными элементами
            смарт-процесса — она называется <strong>«Выставки»</strong> и показывает стандартный grid
            Bitrix (не этот приложение). Это <em>не</em> placement-handler, отключить его в REST-API нельзя.
          </p>
          <p>
            Приложение регистрирует <strong>отдельную</strong> вкладку с заголовком{" "}
            <strong>«Выставка · аналитика»</strong>. Её иконка — логотип приложения; контент — воронки
            лидов и сделок по связанной выставке (<code>{EXPO_LINK_FIELD_HINT}</code>).
          </p>
          <p>
            Если пользователь видит только «Выставки» (native grid), значит placement не зарегистрирован
            или origin handler-а устарел — запустите установку выше, смотрите диагностику. Вкладка
            «Выставка · аналитика» может быть в overflow-меню вкладок, раскройте «Ещё».
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

const EXPO_LINK_FIELD_HINT = "PARENT_ID_1050";

function DiagnosticsPanel({ diagnostics, entityTypeId }: { diagnostics: InstallDiagnostics | null; entityTypeId: number }) {
  const managed = useMemo(() => new Set(getManagedPlacements(entityTypeId)), [entityTypeId]);
  if (!diagnostics) {
    return (
      <Card><CardHeader><CardTitle className="text-lg">Диагностика</CardTitle></CardHeader><CardContent><Empty text="Нажмите кнопку установки." /></CardContent></Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Диагностика</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium">Целевые handlers ({diagnostics.targets.length})</div>
          <div className="grid gap-2">
            {diagnostics.targets.map((t) => (
              <Row key={t.placement} placement={t.placement} handler={t.handler} tone="ok" note={t.title} />
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <div className="mb-2 text-sm font-medium">Зарегистрировано ({diagnostics.registered.length})</div>
          {diagnostics.registeredError ? (
            <div className="text-sm text-red-600">placement.get: {diagnostics.registeredError}</div>
          ) : diagnostics.registered.length === 0 ? (
            <div className="text-sm text-muted-foreground">placement.get не вернул строк.</div>
          ) : (
            <div className="grid gap-2">
              {diagnostics.registered.filter((row) => managed.has(row.placement)).map((row, index) => {
                const stale = diagnostics.stale.some((s) => s.handler === row.handler && s.placement === row.placement);
                const cls = classifyHost(row.handler, diagnostics.origin);
                return (
                  <Row
                    key={`reg-${index}`}
                    placement={row.placement}
                    handler={row.handler}
                    tone={stale ? "stale" : cls.tone}
                    note={cls.label}
                  />
                );
              })}
            </div>
          )}
        </div>
        <Separator />
        <div>
          <div className="mb-2 text-sm font-medium">Проверка после bind ({diagnostics.verified.length})</div>
          {diagnostics.verified.length === 0 ? (
            <div className="text-sm text-muted-foreground">Не выполнена.</div>
          ) : (
            <div className="grid gap-2">
              {diagnostics.verified.map((v, index) => (
                <Row
                  key={`verify-${index}`}
                  placement={v.placement}
                  handler={v.found ? v.actualHandler ?? v.expectedHandler : (v.actualHandler ?? v.expectedHandler)}
                  tone={v.found ? "ok" : "error"}
                  note={v.found ? "найден в placement.get" : v.message}
                />
              ))}
            </div>
          )}
        </div>
        <Separator />
        <div>
          <div className="mb-2 text-sm font-medium">Unbind stale ({diagnostics.unbound.length})</div>
          {diagnostics.unbound.length === 0 ? (
            <div className="text-sm text-muted-foreground">Stale handlers не найдено или unbind не выполнялся.</div>
          ) : (
            <div className="grid gap-2">
              {diagnostics.unbound.map((row, index) => (
                <Row
                  key={`unbind-${index}`}
                  placement={row.placement}
                  handler={row.handler}
                  tone={row.ok ? "ok" : "error"}
                  note={row.ok ? "unbound" : row.message}
                />
              ))}
            </div>
          )}
        </div>
        <Separator />
        <div>
          <div className="mb-2 text-sm font-medium">Результаты bind ({diagnostics.bound.length})</div>
          <div className="grid gap-2">
            {diagnostics.bound.map((row, index) => (
              <Row
                key={`bind-${index}`}
                placement={row.placement}
                handler={row.handler}
                tone={row.ok ? (row.alreadyBound ? "neutral" : "ok") : "error"}
                note={row.alreadyBound ? "already binded (ok)" : row.message}
              />
            ))}
          </div>
        </div>
        {diagnostics.errors.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="mb-2 text-sm font-medium text-red-600">Ошибки ({diagnostics.errors.length})</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
                {diagnostics.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          </>
        )}
        <div className="text-sm text-muted-foreground">
          installFinish: {diagnostics.finished ? "вызван" : "не вызван"}
        </div>
      </CardContent>
    </Card>
  );
}

function CheckPanel({ diagnostics, entityTypeId }: { diagnostics: CheckDiagnostics | null; entityTypeId: number }) {
  const managed = useMemo(() => new Set(getManagedPlacements(entityTypeId)), [entityTypeId]);
  if (!diagnostics) return null;
  const yandexRows = diagnostics.managedRows.filter((r) => r.handler.includes(YANDEX_HOST_MARKER));
  const renderRows = diagnostics.managedRows.filter((r) => r.handler.includes(RENDER_HOST_MARKER));
  const otherRows = diagnostics.managedRows.filter(
    (r) => !r.handler.includes(YANDEX_HOST_MARKER) && !r.handler.includes(RENDER_HOST_MARKER),
  );
  const unmanagedRows = diagnostics.registered.filter((r) => !managed.has(r.placement));
  return (
    <Card className="mt-6" data-testid="card-check-placements">
      <CardHeader>
        <CardTitle className="text-base">placement.get — текущая регистрация</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="text-xs text-muted-foreground">Запущено: {diagnostics.ranAt}. Origin: <code>{diagnostics.origin}</code>.</div>
        {diagnostics.errorMessage ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-700 dark:border-red-900 dark:bg-red-950/30">
            placement.get отказано: <code className="break-all">{diagnostics.errorMessage}</code>
          </div>
        ) : (
          <>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <Stat label="Yandex" value={yandexRows.length} tone="ok" />
              <Stat label="Render-legacy" value={renderRows.length} tone={renderRows.length > 0 ? "stale" : "neutral"} />
              <Stat label="Other host" value={otherRows.length} tone="neutral" />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium">Managed placements ({diagnostics.managedRows.length})</div>
              {diagnostics.managedRows.length === 0 ? (
                <div className="text-xs text-muted-foreground">Нет managed handlers в ответе placement.get.</div>
              ) : (
                <div className="grid gap-2">
                  {diagnostics.managedRows.map((row, index) => {
                    const cls = classifyHost(row.handler, diagnostics.origin);
                    return (
                      <Row
                        key={`mng-${index}`}
                        placement={row.placement}
                        handler={row.handler}
                        tone={cls.tone}
                        note={cls.label}
                      />
                    );
                  })}
                </div>
              )}
            </div>
            {unmanagedRows.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Прочие placement-ы ({unmanagedRows.length})
                </summary>
                <div className="mt-2 grid gap-2">
                  {unmanagedRows.map((row, index) => {
                    const cls = classifyHost(row.handler, diagnostics.origin);
                    return (
                      <Row
                        key={`oth-${index}`}
                        placement={row.placement}
                        handler={row.handler}
                        tone={cls.tone}
                        note={cls.label}
                      />
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "stale" | "neutral" }) {
  const color =
    tone === "ok" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
    : tone === "stale" ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
    : "border-border bg-card";
  return (
    <div className={`rounded-md border p-2 ${color}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function LinkFieldsCard({ inside }: { inside: boolean }) {
  const leadQ = useQuery({
    queryKey: ["install-link-discovery", "lead"],
    queryFn: () => discoverLinkFields("lead"),
    enabled: inside,
  });
  const dealQ = useQuery({
    queryKey: ["install-link-discovery", "deal"],
    queryFn: () => discoverLinkFields("deal"),
    enabled: inside,
  });

  return (
    <Card className="mt-6" data-testid="card-link-fields">
      <CardHeader>
        <CardTitle className="text-base">Связь лидов/сделок через поле «Выставка (календарь)»</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {!inside && (
          <div className="text-muted-foreground">Откройте внутри Bitrix24, чтобы увидеть поля.</div>
        )}
        <LinkFieldBlock
          title="Лиды (crm.lead.fields)"
          loading={leadQ.isLoading}
          error={leadQ.error instanceof Error ? leadQ.error.message : leadQ.error ? String(leadQ.error) : undefined}
          data={leadQ.data}
          manualOverrideConfig={leadExpoFieldCode}
          manualFormatConfig={leadExpoFieldFormat}
        />
        <LinkFieldBlock
          title="Сделки (crm.deal.fields)"
          loading={dealQ.isLoading}
          error={dealQ.error instanceof Error ? dealQ.error.message : dealQ.error ? String(dealQ.error) : undefined}
          data={dealQ.data}
          manualOverrideConfig={dealExpoFieldCode}
          manualFormatConfig={dealExpoFieldFormat}
        />
      </CardContent>
    </Card>
  );
}

function LinkFieldBlock({
  title,
  loading,
  error,
  data,
  manualOverrideConfig,
  manualFormatConfig,
}: {
  title: string;
  loading: boolean;
  error?: string;
  data?: LinkDiscoveryResult;
  manualOverrideConfig: string | null;
  manualFormatConfig: ExpoLinkFormatOverride;
}) {
  const best = data?.bestCandidate;
  const top = (data?.candidates ?? []).slice(0, 10);
  const allCandidates = data?.allCandidates ?? [];
  const totalCount = data?.totalCandidateCount ?? 0;
  const overrideActive = Boolean(data?.manualOverrideActive);
  const warnings = data?.warnings ?? [];

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="font-medium">{title}</div>
      {loading ? (
        <div className="mt-1 text-muted-foreground">Загрузка…</div>
      ) : error ? (
        <div className="mt-1 text-red-600">{error}</div>
      ) : !data ? (
        <div className="mt-1 text-muted-foreground">Нет данных.</div>
      ) : (
        <>
          <div className="mt-2 rounded border bg-background/60 p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Ручной override (config.ts)
            </div>
            <div>
              {manualOverrideConfig
                ? (
                    <>
                      code: <code>{manualOverrideConfig}</code> ·{" "}
                      {overrideActive ? (
                        <span className="text-emerald-700 dark:text-emerald-300">активен (найден в fields)</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">задан, но отсутствует в fields</span>
                      )}
                    </>
                  )
                : <span className="text-muted-foreground">не задан</span>}
            </div>
            <div className="mt-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Format override: </span>
              {manualFormatConfig
                ? (
                    <>
                      <code>{manualFormatConfig}</code>{" "}
                      <span className="text-emerald-700 dark:text-emerald-300">активен</span>
                    </>
                  )
                : <span className="text-muted-foreground">не задан (пробуем все форматы)</span>}
            </div>
          </div>

          <div className="mt-2 rounded border bg-background/60 p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Выбранное/лучшее поле
            </div>
            {best ? (
              <div className="grid gap-0.5">
                <div><span className="text-muted-foreground">code:</span> <code>{best.code}</code></div>
                <div><span className="text-muted-foreground">title:</span> {best.title || "—"}</div>
                {best.listLabel && <div><span className="text-muted-foreground">listLabel:</span> {best.listLabel}</div>}
                {best.formLabel && <div><span className="text-muted-foreground">formLabel:</span> {best.formLabel}</div>}
                <div>
                  <span className="text-muted-foreground">type:</span> {best.type ?? "—"} ·{" "}
                  <span className="text-muted-foreground">userTypeId:</span> {best.userTypeId ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">score:</span> {best.score} ·{" "}
                  <span className="text-muted-foreground">reason:</span> {best.reason}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">— кандидатов не найдено —</div>
            )}
          </div>

          <div className="mt-2 text-muted-foreground">
            Найдено кастомных UF: {data.hasCustom ? "да" : "нет"}. Всего кандидатов: {totalCount}.
          </div>

          {warnings.length > 0 && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="font-medium">Предупреждения</div>
              <ul className="list-disc pl-4">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Топ-{Math.min(top.length, 10)} кандидатов (по score)
          </div>
          {top.length === 0 ? (
            <div className="mt-1 text-muted-foreground">
              Нет полей, подходящих под «Выставка (календарь)» или привязку к entityTypeId=1050.
            </div>
          ) : (
            <ol className="mt-1 space-y-1">
              {top.map((c) => (
                <CandidateRow key={c.code} candidate={c} />
              ))}
            </ol>
          )}

          {allCandidates.length > top.length && (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground">
                Остальные кандидаты ({allCandidates.length - top.length})
              </summary>
              <ol className="mt-1 space-y-1">
                {allCandidates.slice(top.length).map((c) => (
                  <CandidateRow key={c.code} candidate={c} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: LinkFieldCandidate }) {
  return (
    <li className="break-all rounded border bg-background/40 p-1.5">
      <div>
        <code>{candidate.code}</code> · score={candidate.score}
        {candidate.isCustom ? " · UF" : ""}
      </div>
      <div>
        <span className="text-muted-foreground">title:</span> {candidate.title || "—"}
        {candidate.listLabel ? <> · <span className="text-muted-foreground">listLabel:</span> {candidate.listLabel}</> : null}
        {candidate.formLabel ? <> · <span className="text-muted-foreground">formLabel:</span> {candidate.formLabel}</> : null}
      </div>
      <div>
        <span className="text-muted-foreground">type:</span> {candidate.type ?? "—"} ·{" "}
        <span className="text-muted-foreground">userTypeId:</span> {candidate.userTypeId ?? "—"}
      </div>
      <div className="text-muted-foreground">{candidate.reason}</div>
      {candidate.settings && Object.keys(candidate.settings).length > 0 && (
        <>
          <div><span className="text-muted-foreground">settings:</span> {summarizeSettings(candidate.settings) || "(см. ниже)"}</div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">settings JSON</summary>
            <pre className="mt-1 whitespace-pre-wrap text-[10px]">{JSON.stringify(candidate.settings, null, 2)}</pre>
          </details>
        </>
      )}
    </li>
  );
}

function Row({ placement, handler, tone, note }: { placement: string; handler: string; tone: "ok" | "error" | "stale" | "neutral"; note?: string }) {
  const color =
    tone === "ok" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
    : tone === "error" ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
    : tone === "stale" ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
    : "border-border bg-card";
  return (
    <div className={`grid gap-1 rounded-lg border p-2 text-xs ${color}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{placement}</span>
        {note && <span className="text-muted-foreground">{note}</span>}
      </div>
      <code className="break-all text-[11px]">{handler}</code>
    </div>
  );
}

function Notice({ tone, title, text }: { tone: "warning" | "success"; title: string; text: string }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}>
      <div className="flex items-center gap-2 font-medium">
        {tone === "warning" ? <FileWarning className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {title}
      </div>
      <div className="mt-1 opacity-90">{text}</div>
    </div>
  );
}
