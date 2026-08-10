import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty, LoadingRows, Shell } from "./shell";
import EventDetailPage from "./event-detail";
import { fetchDealById, fetchLeadById } from "@/lib/expo-data";
import { candidateExpoIdFromRecord, discoverLinkFields } from "@/lib/expo-link";
import {
  getPlacementEntityId,
  getPlacementInfo,
  isInsideBitrix,
} from "@/lib/bitrix";

/**
 * A deal/lead placement only resolves the exhibition linked to the current CRM
 * record. The actual analytics UI is shared with the Gantt entry point so all
 * three routes always expose the same KPI, funnels and deal table.
 */
export function CrmTab({ entity }: { entity: "deal" | "lead" }) {
  const inBitrix = isInsideBitrix();
  const placement = inBitrix ? getPlacementInfo() : {};
  const placementId = getPlacementEntityId(placement);
  const [manualId, setManualId] = useState("");
  const entityId = placementId ?? manualId;

  const entityQuery = useQuery({
    queryKey: [`${entity}-object`, entityId],
    queryFn: () => (entity === "deal" ? fetchDealById(entityId) : fetchLeadById(entityId)),
    enabled: inBitrix && Boolean(entityId),
  });

  const linkDiscovery = useQuery({
    queryKey: [`${entity}-link-discovery`],
    queryFn: () => discoverLinkFields(entity),
    enabled: inBitrix,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const expoId = useMemo(() => {
    if (!linkDiscovery.data || !entityQuery.data) return undefined;
    const choice = {
      entity,
      candidates: linkDiscovery.data.candidates,
      attempted: [],
      hasCustom: linkDiscovery.data.hasCustom,
      usedFallback: false,
      manualOverrideActive: linkDiscovery.data.manualOverrideActive,
      manualFormatOverrideActive: linkDiscovery.data.manualFormatOverrideActive,
      manualFormatOverride: linkDiscovery.data.manualFormatOverride,
      warnings: linkDiscovery.data.warnings,
      totalCandidateCount: linkDiscovery.data.totalCandidateCount,
    };
    return candidateExpoIdFromRecord(entityQuery.data, choice)?.value;
  }, [entity, entityQuery.data, linkDiscovery.data]);

  if (expoId) {
    return <EventDetailPage params={{ eventId: expoId }} embedded />;
  }

  const entityLabel = entity === "deal" ? "сделки" : "лида";
  const recordLabel = entity === "deal" ? "Сделка" : "Лид";
  const loading = entityQuery.isLoading || linkDiscovery.isLoading;
  const error = entityQuery.error ?? linkDiscovery.error;

  return (
    <Shell embedded>
      {!inBitrix ? (
        <Card>
          <CardContent className="p-4 text-sm">Открыто вне Bitrix24. Доступен только демо-режим.</CardContent>
        </Card>
      ) : !placementId ? (
        <Card className="mb-3">
          <CardContent className="grid gap-2 p-4 sm:max-w-sm">
            <Label>ID {entityLabel} для теста</Label>
            <Input
              value={manualId}
              onChange={(event) => setManualId(event.target.value)}
              placeholder="Введите ID"
              data-testid="input-manual-id"
            />
            <div className="text-xs text-muted-foreground">
              Bitrix24 не передал ID. Введите его вручную или откройте вкладку из карточки CRM.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LoadingRows />
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="space-y-3 p-4 text-sm">
            <Empty text={`Ошибка Bitrix24: ${String((error as Error)?.message ?? error)}`} />
            <Button
              size="sm"
              onClick={() => {
                entityQuery.refetch();
                linkDiscovery.refetch();
              }}
            >
              Повторить
            </Button>
          </CardContent>
        </Card>
      ) : entityId && entityQuery.data ? (
        <Card>
          <CardContent className="p-4">
            <Empty text={`У ${entityLabel} не указана связанная выставка.`} />
          </CardContent>
        </Card>
      ) : entityId ? (
        <Card>
          <CardContent className="p-4">
            <Empty text={`${recordLabel} #${entityId} не загружен. Проверьте права доступа.`} />
          </CardContent>
        </Card>
      ) : null}
    </Shell>
  );
}

export function DealTabPage() {
  return <CrmTab entity="deal" />;
}

export function LeadTabPage() {
  return <CrmTab entity="lead" />;
}
