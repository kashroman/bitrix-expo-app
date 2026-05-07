import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCcw, ShieldCheck, Calculator, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shell, PageTitle } from "./shell";
import { apiRequest } from "@/lib/queryClient";
import { initBitrix, isInsideBitrix } from "@/lib/bitrix";

/**
 * "Источник данных" placement for the smart-process detail page. Reads the
 * current item's UF_CRM_8_SOURCE_URL via BX24 (client-side, like the rest of
 * the app) and exposes a "Проверить сейчас" button that calls /api/recheck.
 *
 * If the placement context cannot be obtained, the page degrades to manual
 * entry of the item id so the operator can still trigger a recheck.
 */
export default function PlacementDetailPage() {
  const [itemId, setItemId] = useState<number | undefined>(undefined);
  const [item, setItem] = useState<any>(null);
  const [bxReady, setBxReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await initBitrix();
      setBxReady(true);
      if (!isInsideBitrix() || !window.BX24) return;
      try {
        const placement = window.BX24.placement.info();
        const id = Number(placement?.options?.ID ?? placement?.options?.id);
        if (Number.isFinite(id)) setItemId(id);
      } catch (err) {
        console.warn("placement.info failed", err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!itemId || !window.BX24) return;
    window.BX24.callMethod(
      "crm.item.get",
      { entityTypeId: 1050, id: itemId },
      (res: any) => {
        if (!res.error()) {
          setItem(res.data()?.item ?? res.data());
        }
      },
    );
  }, [itemId]);

  const recheck = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("itemId не определён");
      const res = await apiRequest("POST", `/api/recheck/${itemId}`, {});
      return await res.json();
    },
  });

  const sourceUrl = useMemo(() => pick(item, "ufCrm8SourceUrl", "UF_CRM_8_SOURCE_URL"), [item]);
  const lastChecked = useMemo(() => pick(item, "ufCrm8LastChecked", "UF_CRM_8_LAST_CHECKED"), [item]);
  const verified = useMemo(() => boolish(pick(item, "ufCrm8Verified", "UF_CRM_8_VERIFIED")), [item]);
  const calculated = useMemo(() => boolish(pick(item, "ufCrm8Calculated", "UF_CRM_8_CALCULATED")), [item]);
  const parseLog = useMemo(() => pick(item, "ufCrm8ParseLog", "UF_CRM_8_PARSE_LOG"), [item]);

  return (
    <Shell embedded>
      <PageTitle
        eyebrow="Smart Enrichment"
        title="Источник данных"
        description="Адрес страницы организатора, статус верификации и история парсинга."
      />
      {!bxReady && <div className="text-sm text-muted-foreground">Инициализация BX24…</div>}
      <Card>
        <CardHeader><CardTitle className="text-base">Карточка #{itemId ?? "—"}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="URL источника" value={sourceUrl ? <a className="text-primary underline" href={sourceUrl} target="_blank" rel="noreferrer">{sourceUrl}</a> : "—"} />
          <Row label="Дата последней проверки" value={lastChecked ?? "—"} />
          <div className="flex flex-wrap gap-2">
            <Badge tone={verified ? "ok" : "warn"} icon={<ShieldCheck className="h-3 w-3" />}>
              {verified ? "Верифицировано" : "Не верифицировано"}
            </Badge>
            {calculated && (
              <Badge tone="info" icon={<Calculator className="h-3 w-3" />}>Расчётные даты</Badge>
            )}
            {!verified && !calculated && (
              <Badge tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>Проверить вручную</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => recheck.mutate()}
              disabled={!itemId || !sourceUrl || recheck.isPending}
              data-testid="button-recheck"
            >
              {recheck.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              Проверить сейчас
            </Button>
          </div>
          {recheck.data && (
            <div className="rounded border bg-muted/30 p-2 text-xs">
              <div>parser: {recheck.data.parser ?? "—"} · confidence: {recheck.data.confidence?.toFixed?.(2) ?? "—"}</div>
              <div>изменений: {Array.isArray(recheck.data.changes) ? recheck.data.changes.length : 0}</div>
            </div>
          )}
          {recheck.error && (
            <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {(recheck.error as Error).message}
            </div>
          )}
        </CardContent>
      </Card>
      {parseLog && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Лог парсинга</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-all text-[11px]">{String(parseLog)}</pre>
          </CardContent>
        </Card>
      )}
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

function Badge({ tone, icon, children }: { tone: "ok" | "warn" | "info"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls =
    tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
    : tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
    : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

function pick(obj: any, ...keys: string[]): any {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function boolish(v: any): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "1" || s === "y" || s === "true";
}
