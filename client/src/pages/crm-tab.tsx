import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shell, Empty, LoadingRows, PageTitle } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import {
  buildExpoAggregate,
  fetchDealById,
  fetchLeadById,
} from "@/lib/expo-data";
import { EXPO_LINK_FIELD, EXPO_ENTITY_TYPE_ID, LeadGroupKey, DealGroupKey } from "@/lib/config";
import {
  getPlacementEntityId,
  getPlacementInfo,
  isInsideBitrix,
  openAppInNewTab,
  openBitrixPath,
} from "@/lib/bitrix";
import { formatDateRange } from "@/lib/format";

function extractExpoIdFromParent(row: Record<string, unknown> | undefined): string | undefined {
  if (!row) return undefined;
  const val = row[EXPO_LINK_FIELD] ?? row[EXPO_LINK_FIELD.toLowerCase()];
  if (val === undefined || val === null || val === "" || val === "0") return undefined;
  return Array.isArray(val) ? String(val[0]) : String(val);
}

export function CrmTab({ entity }: { entity: "deal" | "lead" }) {
  const placement = isInsideBitrix() ? getPlacementInfo() : {};
  const placementId = getPlacementEntityId(placement);
  const [manualId, setManualId] = useState("");
  const entityId = placementId ?? manualId;

  const entityQuery = useQuery({
    queryKey: [`${entity}-object`, entityId],
    queryFn: () => (entity === "deal" ? fetchDealById(entityId) : fetchLeadById(entityId)),
    enabled: isInsideBitrix() && Boolean(entityId),
  });

  const expoId = useMemo(() => extractExpoIdFromParent(entityQuery.data), [entityQuery.data]);

  const agg = useQuery({
    queryKey: ["expo-aggregate", expoId ? Number(expoId) : undefined],
    queryFn: () => buildExpoAggregate(expoId!),
    enabled: isInsideBitrix() && Boolean(expoId),
  });

  const label = entity === "deal" ? "сделки" : "лида";

  return (
    <Shell embedded>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-primary">Вкладка {label}</div>
          <div className="text-base font-semibold">{agg.data?.expo.title ?? "Аналитика по выставке"}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openAppInNewTab("/calendar")}
          data-testid="button-open-calendar"
        >
          <CalendarDays className="mr-1.5 h-4 w-4" />
          Перейти ко всему календарю
        </Button>
      </div>

      {!isInsideBitrix() ? (
        <Card><CardContent className="p-4 text-sm">Открыто вне Bitrix24. Доступен только демо-режим.</CardContent></Card>
      ) : !placementId ? (
        <Card className="mb-3">
          <CardContent className="grid gap-2 p-4 sm:max-w-sm">
            <Label>ID {label} для теста</Label>
            <Input value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Введите ID" data-testid="input-manual-id" />
            <div className="text-xs text-muted-foreground">
              placement.info() не вернул ID. Введите значение вручную или откройте вкладку из карточки Bitrix24.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {entityQuery.isLoading ? (
        <LoadingRows />
      ) : !entityQuery.data && entityId ? (
        <Card><CardContent className="p-4"><Empty text={`${entity === "deal" ? "Сделка" : "Лид"} не загружен или Bitrix24 вернул ошибку.`} /></CardContent></Card>
      ) : !expoId ? (
        <Card><CardContent className="p-4"><Empty text={`У ${label} не указана связанная выставка (${EXPO_LINK_FIELD}).`} /></CardContent></Card>
      ) : agg.isLoading ? (
        <LoadingRows />
      ) : !agg.data ? (
        <Card><CardContent className="p-4"><Empty text="Связанная выставка не найдена в смарт-процессе." /></CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="text-base">Выставка</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <FieldLine label="Название" value={agg.data.expo.title} />
              <FieldLine label="ID" value={String(agg.data.expo.id)} />
              <FieldLine label="Проведение" value={formatDateRange(agg.data.expo.expoStart, agg.data.expo.expoEnd)} />
              <FieldLine label="Монтаж" value={formatDateRange(agg.data.expo.installStart, agg.data.expo.installEnd)} />
              <FieldLine label="Демонтаж" value={formatDateRange(agg.data.expo.dismantleStart, agg.data.expo.dismantleEnd)} />
              <div className="pt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openBitrixPath(`/crm/type/${EXPO_ENTITY_TYPE_ID}/details/${agg.data!.expo.id}/`)}
                  data-testid="button-open-expo"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Карточка
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAppInNewTab(`/event/${agg.data!.expo.id}`)}
                  data-testid="button-open-event"
                >
                  Подробная сводка
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Воронка лидов</CardTitle></CardHeader>
            <CardContent>
              <LeadFunnel
                stats={agg.data.leadStats}
                onSelect={(group: LeadGroupKey) => openAppInNewTab(`/event/${agg.data!.expo.id}/leads?group=${group}`)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Воронка сделок</CardTitle></CardHeader>
            <CardContent>
              <DealFunnel
                stats={agg.data.dealStats}
                onSelect={(group: DealGroupKey) => openAppInNewTab(`/event/${agg.data!.expo.id}/deals?group=${group}`)}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </Shell>
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

export function DealTabPage() {
  return <CrmTab entity="deal" />;
}

export function LeadTabPage() {
  return <CrmTab entity="lead" />;
}

export { PageTitle };
