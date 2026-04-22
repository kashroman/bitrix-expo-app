import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shell, PageTitle, Empty, LoadingRows } from "./shell";
import { LeadFunnel, DealFunnel } from "@/components/funnel";
import { buildExpoAggregate } from "@/lib/expo-data";
import { EXPO_ENTITY_TYPE_ID, DealGroupKey, LeadGroupKey } from "@/lib/config";
import { formatDateRange } from "@/lib/format";
import { isInsideBitrix, openBitrixPath } from "@/lib/bitrix";

export default function EventDetailPage({ params }: { params: { eventId: string } }) {
  const eventId = params.eventId;
  const agg = useQuery({
    queryKey: ["expo-aggregate", Number(eventId)],
    queryFn: () => buildExpoAggregate(eventId),
    enabled: isInsideBitrix() && Boolean(eventId),
  });

  return (
    <Shell>
      <div className="mb-4 flex items-center gap-2">
        <Link href="/calendar">
          <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Ко всему календарю
          </a>
        </Link>
      </div>

      <PageTitle
        eyebrow="Выставка"
        title={agg.data?.expo.title ?? `Выставка #${eventId}`}
      />

      {agg.isLoading ? (
        <LoadingRows />
      ) : agg.isError ? (
        <Empty text={`Ошибка Bitrix24 API: ${String((agg.error as Error)?.message ?? agg.error)}`} />
      ) : !agg.data ? (
        <Empty text="Выставка не найдена. Возможно, элемент смарт-процесса удалён или у пользователя нет прав на чтение." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Информация о выставке</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <FieldLine label="ID" value={String(agg.data.expo.id)} />
                <FieldLine label="Название" value={agg.data.expo.title} />
                <FieldLine label="Проведение" value={formatDateRange(agg.data.expo.expoStart, agg.data.expo.expoEnd)} />
                <FieldLine label="Монтаж" value={formatDateRange(agg.data.expo.installStart, agg.data.expo.installEnd)} />
                <FieldLine label="Демонтаж" value={formatDateRange(agg.data.expo.dismantleStart, agg.data.expo.dismantleEnd)} />
                {agg.data.expo.responsibleId && (
                  <FieldLine label="Ответственный ID" value={String(agg.data.expo.responsibleId)} />
                )}
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openBitrixPath(`/crm/type/${EXPO_ENTITY_TYPE_ID}/details/${agg.data!.expo.id}/`)}
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
                  <Kpi label="Лидов" value={agg.data.leadStats.total} />
                  <Kpi label="Успешных" value={agg.data.leadStats.success} tone="success" />
                  <Kpi label="Сделок" value={agg.data.dealStats.total} />
                  <Kpi label="Выигранных" value={agg.data.dealStats.won} tone="success" />
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
                  stats={agg.data.leadStats}
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
                  stats={agg.data.dealStats}
                  onSelect={(group: DealGroupKey) => {
                    window.location.hash = `/event/${eventId}/deals?group=${group}`;
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </>
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
