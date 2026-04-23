import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shell, PageTitle, Empty, LoadingRows } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import { buildExpoAggregate, isFoundAggregate } from "@/lib/expo-data";
import { EXPO_ENTITY_TYPE_ID, DealGroupKey, LeadGroupKey } from "@/lib/config";
import { getPlacementEntityId, getPlacementInfo, isInsideBitrix, openAppInNewTab, openBitrixPath } from "@/lib/bitrix";
import { formatDateRange } from "@/lib/format";

export default function ExpoTabPage() {
  const placement = isInsideBitrix() ? getPlacementInfo() : {};
  const placementId = getPlacementEntityId(placement);
  const [manualId, setManualId] = useState("");
  const queryId = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const fromSearch = new URLSearchParams(window.location.search).get("id");
    if (fromSearch) return fromSearch;
    const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
    return new URLSearchParams(hashQuery).get("id") ?? undefined;
  }, []);
  const expoId = placementId ?? queryId ?? manualId;

  const agg = useQuery({
    queryKey: ["expo-aggregate", expoId ? Number(expoId) : undefined],
    queryFn: () => buildExpoAggregate(expoId),
    enabled: isInsideBitrix() && Boolean(expoId),
  });
  const foundAgg = isFoundAggregate(agg.data) ? agg.data : undefined;
  const notFoundAgg = agg.data && agg.data.status === "not-found" ? agg.data : undefined;

  return (
    <Shell embedded>
      <PageTitle eyebrow="Вкладка выставки" title={foundAgg?.expo.title ?? "Карточка выставки"} />

      {!isInsideBitrix() ? (
        <Card><CardContent className="p-4 text-sm">Открыто вне Bitrix24.</CardContent></Card>
      ) : !placementId && !queryId ? (
        <Card className="mb-3">
          <CardContent className="grid gap-2 p-4 sm:max-w-sm">
            <Label>ID выставки</Label>
            <Input value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Введите ID" />
          </CardContent>
        </Card>
      ) : null}

      {agg.isLoading ? <LoadingRows /> : notFoundAgg ? (
        <Card><CardContent className="space-y-2 p-4">
          <Empty text={`Выставка #${notFoundAgg.expoId} не найдена.`} />
          {notFoundAgg.diagnostics.errors.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {notFoundAgg.diagnostics.errors.join("; ")}
            </div>
          )}
        </CardContent></Card>
      ) : !foundAgg ? (
        <Card><CardContent className="p-4"><Empty text="Выставка не найдена." /></CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          <Card>
            <CardHeader><CardTitle className="text-base">Информация</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Название</span><span className="font-medium">{foundAgg.expo.title}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Проведение</span><span>{formatDateRange(foundAgg.expo.expoStart, foundAgg.expo.expoEnd)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Монтаж</span><span>{formatDateRange(foundAgg.expo.installStart, foundAgg.expo.installEnd)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Демонтаж</span><span>{formatDateRange(foundAgg.expo.dismantleStart, foundAgg.expo.dismantleEnd)}</span></div>
              <div className="pt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openBitrixPath(`/crm/type/${EXPO_ENTITY_TYPE_ID}/details/${foundAgg.expo.id}/`)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Карточка
                </Button>
                <Button variant="outline" size="sm" onClick={() => openAppInNewTab("/calendar")}>
                  <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Календарь
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Лиды</CardTitle></CardHeader>
            <CardContent>
              <LeadFunnel stats={foundAgg.leadStats} onSelect={(g: LeadGroupKey) => openAppInNewTab(`/event/${foundAgg.expo.id}/leads?group=${g}`)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Сделки</CardTitle></CardHeader>
            <CardContent>
              <DealFunnel stats={foundAgg.dealStats} onSelect={(g: DealGroupKey) => openAppInNewTab(`/event/${foundAgg.expo.id}/deals?group=${g}`)} />
            </CardContent>
          </Card>
        </div>
      )}
    </Shell>
  );
}
