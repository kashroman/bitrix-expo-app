import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shell, PageTitle, Empty, LoadingRows } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import { buildExpoAggregate } from "@/lib/expo-data";
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

  return (
    <Shell embedded>
      <PageTitle eyebrow="Вкладка выставки" title={agg.data?.expo.title ?? "Карточка выставки"} />

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

      {agg.isLoading ? <LoadingRows /> : !agg.data ? (
        <Card><CardContent className="p-4"><Empty text="Выставка не найдена." /></CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          <Card>
            <CardHeader><CardTitle className="text-base">Информация</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Название</span><span className="font-medium">{agg.data.expo.title}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Проведение</span><span>{formatDateRange(agg.data.expo.expoStart, agg.data.expo.expoEnd)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Монтаж</span><span>{formatDateRange(agg.data.expo.installStart, agg.data.expo.installEnd)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Демонтаж</span><span>{formatDateRange(agg.data.expo.dismantleStart, agg.data.expo.dismantleEnd)}</span></div>
              <div className="pt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openBitrixPath(`/crm/type/${EXPO_ENTITY_TYPE_ID}/details/${agg.data!.expo.id}/`)}>
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
              <LeadFunnel stats={agg.data.leadStats} onSelect={(g: LeadGroupKey) => openAppInNewTab(`/event/${agg.data!.expo.id}/leads?group=${g}`)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Сделки</CardTitle></CardHeader>
            <CardContent>
              <DealFunnel stats={agg.data.dealStats} onSelect={(g: DealGroupKey) => openAppInNewTab(`/event/${agg.data!.expo.id}/deals?group=${g}`)} />
            </CardContent>
          </Card>
        </div>
      )}
    </Shell>
  );
}
