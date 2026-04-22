import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileWarning, Loader2 } from "lucide-react";
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
import { EXPO_ENTITY_TYPE_ID } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";

type InstallTargetHandler = {
  placement: string;
  handler: string;
  title: string;
  description: string;
};

type InstallDiagnostics = {
  origin: string;
  registered: RegisteredHandler[];
  stale: RegisteredHandler[];
  unbound: { placement: string; handler: string; ok: boolean; message?: string }[];
  bound: { placement: string; handler: string; ok: boolean; alreadyBound: boolean; message?: string }[];
  targets: InstallTargetHandler[];
  errors: string[];
  finished: boolean;
};

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
          placement: "CRM_ANALYTICS_MENU",
          handler: currentHandlerUrl("/calendar"),
          title: "Календарь выставок",
          description: "Календарь выставок interpro.pro",
        },
      ];

      const diag: InstallDiagnostics = {
        origin,
        registered: [],
        stale: [],
        unbound: [],
        bound: [],
        targets,
        errors: [],
        finished: false,
      };

      try {
        diag.registered = await listRegisteredPlacements();
      } catch (error) {
        diag.errors.push(`placement.get: ${error instanceof Error ? error.message : String(error)}`);
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

      const allBindsOk = diag.bound.every((entry) => entry.ok);
      if (allBindsOk) {
        try {
          window.BX24.installFinish();
          diag.finished = true;
        } catch (error) {
          diag.errors.push(`installFinish: ${error instanceof Error ? error.message : String(error)}`);
        }
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
              <Notice tone="warning" title="Открыто вне Bitrix24" text="Кнопка установки работает только внутри iframe установки Bitrix24." />
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
              <code className="rounded bg-background px-2 py-1 text-xs">CRM_ANALYTICS_MENU → /calendar</code>
            </div>
            {installStatus && <Notice tone={installStatus.tone} title={installStatus.title} text={installStatus.text} />}
            <Button onClick={() => install.mutate()} disabled={install.isPending || !ready.data?.inside} data-testid="button-install">
              {install.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Переустановить и завершить установку
            </Button>
          </CardContent>
        </Card>

        <DiagnosticsPanel diagnostics={diagnostics} entityTypeId={entityTypeId} />
      </div>
    </Shell>
  );
}

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
          {diagnostics.registered.length === 0 ? (
            <div className="text-sm text-muted-foreground">placement.get не вернул строк.</div>
          ) : (
            <div className="grid gap-2">
              {diagnostics.registered.filter((row) => managed.has(row.placement)).map((row, index) => (
                <Row
                  key={`reg-${index}`}
                  placement={row.placement}
                  handler={row.handler}
                  tone={diagnostics.stale.some((s) => s.handler === row.handler && s.placement === row.placement) ? "stale" : "neutral"}
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
