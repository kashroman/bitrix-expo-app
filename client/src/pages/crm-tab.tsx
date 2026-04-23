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
  isFoundAggregate,
} from "@/lib/expo-data";
import {
  candidateExpoIdFromRecord,
  discoverLinkFields,
  LinkFieldCandidate,
  LinkDiscoveryResult,
  readRecordFieldValue,
} from "@/lib/expo-link";
import { EXPO_ENTITY_TYPE_ID, LeadGroupKey, DealGroupKey } from "@/lib/config";
import {
  getPlacementEntityId,
  getPlacementInfo,
  isInsideBitrix,
  openAppInNewTab,
  openBitrixPath,
} from "@/lib/bitrix";
import { formatDateRange } from "@/lib/format";

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

  const linkDiscovery = useQuery({
    queryKey: [`${entity}-link-discovery`],
    queryFn: () => discoverLinkFields(entity),
    enabled: isInsideBitrix(),
  });

  const { expoId, expoIdField } = useMemo(() => {
    const choice = linkDiscovery.data
      ? {
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
        }
      : undefined;
    const picked = candidateExpoIdFromRecord(entityQuery.data, choice);
    return { expoId: picked?.value, expoIdField: picked?.field };
  }, [entityQuery.data, linkDiscovery.data, entity]);

  const agg = useQuery({
    queryKey: ["expo-aggregate", expoId ? Number(expoId) : undefined],
    queryFn: () => buildExpoAggregate(expoId!),
    enabled: isInsideBitrix() && Boolean(expoId),
  });
  const foundAgg = isFoundAggregate(agg.data) ? agg.data : undefined;
  const notFoundAgg = agg.data && agg.data.status === "not-found" ? agg.data : undefined;

  const label = entity === "deal" ? "сделки" : "лида";

  return (
    <Shell embedded>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-primary">Вкладка {label}</div>
          <div className="text-base font-semibold">{foundAgg?.expo.title ?? "Аналитика по выставке"}</div>
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
      ) : entityQuery.isError ? (
        <Card className="border-destructive/40"><CardContent className="space-y-3 p-4 text-sm">
          <Empty text={`Ошибка Bitrix24: ${String((entityQuery.error as Error)?.message ?? entityQuery.error)}`} />
          <Button variant="default" size="sm" onClick={() => entityQuery.refetch()} data-testid="button-retry-entity">Повторить</Button>
        </CardContent></Card>
      ) : !entityQuery.data && entityId ? (
        <Card><CardContent className="space-y-3 p-4">
          <Empty text={`${entity === "deal" ? "Сделка" : "Лид"} #${entityId} не загружен. Проверьте права или введите другой ID.`} />
          <Button variant="outline" size="sm" onClick={() => entityQuery.refetch()} data-testid="button-retry-entity">Повторить</Button>
        </CardContent></Card>
      ) : !expoId ? (
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <Empty text={`У ${label} не указана связанная выставка.`} />
            <LinkDiagnostics
              entity={entity}
              discovery={linkDiscovery.data}
              record={entityQuery.data}
              chosenField={undefined}
            />
          </CardContent>
        </Card>
      ) : agg.isLoading ? (
        <LoadingRows />
      ) : agg.isError ? (
        <Card className="border-destructive/40"><CardContent className="space-y-3 p-4 text-sm">
          <Empty text={`Ошибка загрузки выставки #${expoId}: ${String((agg.error as Error)?.message ?? agg.error)}`} />
          <Button variant="default" size="sm" onClick={() => agg.refetch()} data-testid="button-retry-agg">Повторить</Button>
        </CardContent></Card>
      ) : notFoundAgg ? (
        <Card><CardContent className="space-y-3 p-4">
          <Empty text={`Связанная выставка #${expoId} не найдена в смарт-процессе.`} />
          {notFoundAgg.diagnostics.errors.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {notFoundAgg.diagnostics.errors.join("; ")}
            </div>
          )}
          <AggDiagnostics
            leadChoice={notFoundAgg.diagnostics.lead}
            dealChoice={notFoundAgg.diagnostics.deal}
            errors={notFoundAgg.diagnostics.errors}
            currentEntity={entity}
            currentField={expoIdField}
          />
          <Button variant="outline" size="sm" onClick={() => agg.refetch()} data-testid="button-retry-agg">Повторить</Button>
        </CardContent></Card>
      ) : foundAgg ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="text-base">Выставка</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <FieldLine label="Название" value={foundAgg.expo.title} />
              <FieldLine label="ID" value={String(foundAgg.expo.id)} />
              <FieldLine label="Проведение" value={formatDateRange(foundAgg.expo.expoStart, foundAgg.expo.expoEnd)} />
              <FieldLine label="Монтаж" value={formatDateRange(foundAgg.expo.installStart, foundAgg.expo.installEnd)} />
              <FieldLine label="Демонтаж" value={formatDateRange(foundAgg.expo.dismantleStart, foundAgg.expo.dismantleEnd)} />
              <div className="pt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openBitrixPath(`/crm/type/${EXPO_ENTITY_TYPE_ID}/details/${foundAgg.expo.id}/`)}
                  data-testid="button-open-expo"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Карточка
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAppInNewTab(`/event/${foundAgg.expo.id}`)}
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
                stats={foundAgg.leadStats}
                onSelect={(group: LeadGroupKey) => openAppInNewTab(`/event/${foundAgg.expo.id}/leads?group=${group}`)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Воронка сделок</CardTitle></CardHeader>
            <CardContent>
              <DealFunnel
                stats={foundAgg.dealStats}
                onSelect={(group: DealGroupKey) => openAppInNewTab(`/event/${foundAgg.expo.id}/deals?group=${group}`)}
              />
            </CardContent>
          </Card>

          <div className="lg:col-span-3">
            <AggDiagnostics
              leadChoice={foundAgg.diagnostics.lead}
              dealChoice={foundAgg.diagnostics.deal}
              errors={foundAgg.diagnostics.errors}
              currentEntity={entity}
              currentField={expoIdField}
            />
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function AggDiagnostics({
  leadChoice,
  dealChoice,
  errors,
  currentEntity,
  currentField,
}: {
  leadChoice: import("@/lib/expo-link").LinkFieldChoice;
  dealChoice: import("@/lib/expo-link").LinkFieldChoice;
  errors: string[];
  currentEntity: "deal" | "lead";
  currentField?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs">
      <div className="mb-1 font-medium">Диагностика связей</div>
      <div className="grid gap-1">
        <div>
          Лиды → поле: <code>{leadChoice.chosenField ?? "—"}</code>, формат:{" "}
          <code>{leadChoice.chosenFormat ?? "—"}</code>, кастомных кандидатов: {leadChoice.candidates.filter((c) => c.isCustom).length},
          fallback: {leadChoice.usedFallback ? "да" : "нет"}
          {leadChoice.manualOverrideActive ? " · override активен" : ""}
          {leadChoice.manualFormatOverrideActive ? (
            <> · format override: <code>{leadChoice.manualFormatOverride ?? "—"}</code></>
          ) : null}
        </div>
        <div>
          Сделки → поле: <code>{dealChoice.chosenField ?? "—"}</code>, формат:{" "}
          <code>{dealChoice.chosenFormat ?? "—"}</code>, кастомных кандидатов: {dealChoice.candidates.filter((c) => c.isCustom).length},
          fallback: {dealChoice.usedFallback ? "да" : "нет"}
          {dealChoice.manualOverrideActive ? " · override активен" : ""}
          {dealChoice.manualFormatOverrideActive ? (
            <> · format override: <code>{dealChoice.manualFormatOverride ?? "—"}</code></>
          ) : null}
        </div>
        <div>
          Текущая вкладка ({currentEntity}): поле на записи — <code>{currentField ?? "—"}</code>
        </div>
        {(leadChoice.warnings?.length || dealChoice.warnings?.length) ? (
          <div className="text-amber-700 dark:text-amber-300">
            {[...(leadChoice.warnings ?? []).map((w) => `лид: ${w}`), ...(dealChoice.warnings ?? []).map((w) => `сделка: ${w}`)].join("; ")}
          </div>
        ) : null}
        {errors.length > 0 && (
          <div className="text-red-600">Ошибки: {errors.join("; ")}</div>
        )}
      </div>
    </div>
  );
}

function LinkDiagnostics({
  entity,
  discovery,
  record,
  chosenField,
}: {
  entity: "deal" | "lead";
  discovery: LinkDiscoveryResult | undefined;
  record: Record<string, unknown> | undefined;
  chosenField?: string;
}) {
  const candidates = discovery?.candidates ?? [];
  const hasCustom = discovery?.hasCustom ?? false;
  const best = discovery?.bestCandidate;
  const topCandidates = candidates.slice(0, 6);

  const checkedCode = chosenField ?? best?.code;
  const checkedValueRaw = checkedCode ? readRecordFieldValue(record, checkedCode) : undefined;
  const checkedValueEmpty =
    checkedValueRaw === undefined || checkedValueRaw === null || checkedValueRaw === "" || checkedValueRaw === "0";

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs">
      <div className="mb-1 font-medium">
        Диагностика поля «Выставка (календарь)» для {entity === "deal" ? "сделки" : "лида"}
      </div>

      {checkedCode ? (
        <div className="rounded border bg-background/60 p-2">
          <div>
            Проверено поле: <code>{checkedCode}</code>
            {best && best.code === checkedCode && best.title ? (
              <> · <span className="text-muted-foreground">{best.title}</span></>
            ) : null}
          </div>
          <div>
            Значение на записи:{" "}
            {checkedValueEmpty ? (
              <span className="text-muted-foreground">— (пусто)</span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-300">{JSON.stringify(checkedValueRaw)}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground">Поле для проверки не выбрано (нет кандидатов).</div>
      )}

      <div className="mt-2 text-muted-foreground">
        Найдены кастомные UF: {hasCustom ? "да" : "нет"}. Всего кандидатов: {discovery?.totalCandidateCount ?? candidates.length}.
        {discovery?.manualOverride ? (
          <> Ручной override: <code>{discovery.manualOverride}</code>{" "}
            {discovery.manualOverrideActive ? "(активен)" : "(не найден в fields)"}.
          </>
        ) : null}
      </div>

      {discovery?.warnings && discovery.warnings.length > 0 && (
        <div className="mt-1 text-amber-700 dark:text-amber-300">{discovery.warnings.join("; ")}</div>
      )}

      {topCandidates.length === 0 ? (
        <div className="mt-2 text-muted-foreground">
          Кандидатов не найдено. Проверьте, что у поля есть заголовок, содержащий «Выставка (календарь)».
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {topCandidates.map((candidate: LinkFieldCandidate) => {
            const raw = readRecordFieldValue(record, candidate.code);
            return (
              <li key={candidate.code} className="break-all">
                <span className="font-medium">{candidate.code}</span> · {candidate.title || "—"} · type={candidate.type ?? "—"} ·
                score={candidate.score}
                {raw !== undefined && raw !== null && raw !== "" ? (
                  <> · <span className="text-emerald-700 dark:text-emerald-300">value={JSON.stringify(raw)}</span></>
                ) : (
                  <> · <span className="text-muted-foreground">value: —</span></>
                )}
              </li>
            );
          })}
        </ul>
      )}
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

export function DealTabPage() {
  return <CrmTab entity="deal" />;
}

export function LeadTabPage() {
  return <CrmTab entity="lead" />;
}

export { PageTitle };
