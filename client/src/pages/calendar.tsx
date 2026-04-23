import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { RefreshCw, BarChart3, CalendarDays, List as ListIcon, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shell, PageTitle, Empty, LoadingRows } from "./shell";
import { GanttTimeline } from "@/components/gantt";
import { CalendarView } from "@/components/calendar-view";
import {
  buildExpoAggregate,
  ExpoAggregate,
  ExpoItem,
  fetchExpoList,
  isFoundAggregate,
} from "@/lib/expo-data";
import { formatDateRange } from "@/lib/format";
import { queryClient } from "@/lib/queryClient";
import { isInsideBitrix } from "@/lib/bitrix";

type ViewMode = "gantt" | "calendar" | "list";
type PeriodMode = "all" | "current" | "future" | "past" | "year";

export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>("gantt");
  const [period, setPeriod] = useState<PeriodMode>("all");
  const [responsible, setResponsible] = useState<string>("all");
  const [search, setSearch] = useState("");

  const expos = useQuery({
    queryKey: ["expo-list"],
    queryFn: fetchExpoList,
    enabled: isInsideBitrix(),
  });

  const responsibles = useMemo(() => {
    const ids = new Set<string>();
    (expos.data ?? []).forEach((expo) => {
      if (expo.responsibleId) ids.add(String(expo.responsibleId));
    });
    return Array.from(ids);
  }, [expos.data]);

  const filtered = useMemo(() => {
    const list = expos.data ?? [];
    const now = Date.now();
    const lower = search.trim().toLocaleLowerCase("ru-RU");
    return list.filter((expo) => {
      if (responsible !== "all" && String(expo.responsibleId ?? "") !== responsible) return false;
      if (lower && !expo.title.toLocaleLowerCase("ru-RU").includes(lower)) return false;
      if (period !== "all") {
        const start = expo.expoStart ? new Date(expo.expoStart).getTime() : undefined;
        const end = expo.expoEnd ? new Date(expo.expoEnd).getTime() : undefined;
        if (period === "current" && !(start && end && start <= now && now <= end)) return false;
        if (period === "future" && !(start && start > now)) return false;
        if (period === "past" && !(end && end < now)) return false;
        if (period === "year" && start) {
          const year = new Date().getFullYear();
          if (new Date(start).getFullYear() !== year) return false;
        }
      }
      return true;
    });
  }, [expos.data, responsible, search, period]);

  return (
    <Shell>
      <PageTitle
        eyebrow="Календарь"
        title="Календарь выставок"
        description="Основной рабочий экран: переключение между Gantt, Calendar и List, фильтры по периоду и ответственному, поиск."
      />

      {!isInsideBitrix() && (
        <Card className="mb-4 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="p-3 text-sm">
            Приложение запущено вне Bitrix24 (демо-режим). Данные CRM недоступны.
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[auto_auto_auto_1fr_auto]">
          <div className="flex rounded-md border p-0.5">
            <ViewButton mode="gantt" active={view} onClick={setView} icon={<BarChart3 className="h-4 w-4" />} label="Gantt" />
            <ViewButton mode="calendar" active={view} onClick={setView} icon={<CalendarDays className="h-4 w-4" />} label="Calendar" />
            <ViewButton mode="list" active={view} onClick={setView} icon={<ListIcon className="h-4 w-4" />} label="List" />
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodMode)}>
            <SelectTrigger className="w-[180px]" data-testid="select-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все периоды</SelectItem>
              <SelectItem value="current">Сейчас идут</SelectItem>
              <SelectItem value="future">Будущие</SelectItem>
              <SelectItem value="past">Прошедшие</SelectItem>
              <SelectItem value="year">Текущий год</SelectItem>
            </SelectContent>
          </Select>
          {responsibles.length > 0 && (
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger className="w-[180px]" data-testid="select-responsible"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все ответственные</SelectItem>
                {responsibles.map((id) => (
                  <SelectItem key={id} value={id}>ID {id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Поиск по названию выставки"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["expo-list"] })}
            data-testid="button-refresh"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Выставки ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {expos.isLoading ? (
            <LoadingRows />
          ) : expos.isError ? (
            <Empty text={`Ошибка Bitrix24 API: ${String((expos.error as Error)?.message ?? expos.error)}`} />
          ) : !filtered.length ? (
            <Empty text="Выставок не найдено. Измените фильтры или добавьте элементы в смарт-процесс." />
          ) : view === "gantt" ? (
            <GanttView expos={filtered} />
          ) : view === "calendar" ? (
            <CalendarView expos={filtered} onSelect={(expo) => navigateToEvent(expo.id)} />
          ) : (
            <ListView expos={filtered} />
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

function ViewButton({
  mode,
  active,
  onClick,
  icon,
  label,
}: {
  mode: ViewMode;
  active: ViewMode;
  onClick: (mode: ViewMode) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const isActive = active === mode;
  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      data-testid={`view-${mode}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function GanttView({ expos }: { expos: ExpoItem[] }) {
  return (
    <GanttTimeline
      expos={expos}
      onSelect={(expo) => navigateToEvent(expo.id)}
      renderRight={(expo) => <StatsMini expoId={expo.id} />}
    />
  );
}

function ListView({ expos }: { expos: ExpoItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3">Название</th>
            <th className="py-2 pr-3">Даты проведения</th>
            <th className="py-2 pr-3">Монтаж</th>
            <th className="py-2 pr-3">Демонтаж</th>
            <th className="py-2 pr-3">Лиды</th>
            <th className="py-2 pr-3">Сделки</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {expos.map((expo) => (
            <tr key={expo.id} className="border-b hover:bg-accent/40" data-testid={`list-row-${expo.id}`}>
              <td className="py-2 pr-3 font-medium">{expo.title}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatDateRange(expo.expoStart, expo.expoEnd)}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatDateRange(expo.installStart, expo.installEnd)}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatDateRange(expo.dismantleStart, expo.dismantleEnd)}</td>
              <td className="py-2 pr-3"><StatsCount expoId={expo.id} kind="lead" /></td>
              <td className="py-2 pr-3"><StatsCount expoId={expo.id} kind="deal" /></td>
              <td className="py-2 pr-3 text-right">
                <Link href={`/event/${expo.id}`}>
                  <a className="text-sm font-medium text-primary hover:underline" data-testid={`link-open-${expo.id}`}>Открыть</a>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsMini({ expoId }: { expoId: number }) {
  const agg = useQuery({
    queryKey: ["expo-aggregate", expoId],
    queryFn: () => buildExpoAggregate(expoId),
    enabled: isInsideBitrix(),
  });
  const data = isFoundAggregate(agg.data) ? agg.data : undefined;
  if (!data) return null;
  return (
    <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
      <span>Лиды: <b className="text-foreground">{data.leadStats.total}</b></span>
      <span>Сделки: <b className="text-foreground">{data.dealStats.total}</b></span>
      <span className="text-emerald-600">Выигр.: {data.dealStats.won}</span>
    </div>
  );
}

function StatsCount({ expoId, kind }: { expoId: number; kind: "lead" | "deal" }) {
  const agg = useQuery<ExpoAggregate>({
    queryKey: ["expo-aggregate", expoId],
    queryFn: () => buildExpoAggregate(expoId),
    enabled: isInsideBitrix(),
  });
  const data = isFoundAggregate(agg.data) ? agg.data : undefined;
  if (!data) return <span className="text-muted-foreground">…</span>;
  const stats = kind === "lead" ? data.leadStats : data.dealStats;
  return <span className="font-medium">{stats.total}</span>;
}

function navigateToEvent(id: number | string) {
  window.location.hash = `/event/${id}`;
}
