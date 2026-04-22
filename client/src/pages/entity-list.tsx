import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Shell, PageTitle, Empty, LoadingRows } from "./shell";
import {
  buildExpoAggregate,
  ExpoAggregate,
} from "@/lib/expo-data";
import {
  DEAL_GROUP_LABELS,
  DealGroupKey,
  LEAD_GROUP_LABELS,
  LeadGroupKey,
} from "@/lib/config";
import { CrmItem, isInsideBitrix, openBitrixPath } from "@/lib/bitrix";
import { formatValue } from "@/lib/format";

type Entity = "lead" | "deal";

type ColumnDef = {
  key: string;
  label: string;
  default: boolean;
  render?: (row: CrmItem) => React.ReactNode;
};

const LEAD_COLUMNS: ColumnDef[] = [
  { key: "ID", label: "ID", default: true },
  { key: "TITLE", label: "Название", default: true },
  { key: "STATUS_ID", label: "Статус", default: true },
  { key: "ASSIGNED_BY_ID", label: "Ответственный", default: true },
  { key: "DATE_CREATE", label: "Создан", default: true },
  { key: "DATE_MODIFY", label: "Изменён", default: false },
  { key: "SOURCE_ID", label: "Источник", default: false },
  { key: "NAME", label: "Имя", default: false },
  { key: "LAST_NAME", label: "Фамилия", default: false },
];

const DEAL_COLUMNS: ColumnDef[] = [
  { key: "ID", label: "ID", default: true },
  { key: "TITLE", label: "Название", default: true },
  { key: "STAGE_ID", label: "Стадия", default: true },
  { key: "OPPORTUNITY", label: "Сумма", default: true },
  { key: "ASSIGNED_BY_ID", label: "Ответственный", default: true },
  { key: "DATE_CREATE", label: "Создан", default: true },
  { key: "DATE_MODIFY", label: "Изменён", default: false },
  { key: "COMPANY_ID", label: "Компания", default: false },
  { key: "CONTACT_ID", label: "Контакт", default: false },
];

function useUrlParam(name: string): string | undefined {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const qs = hash.includes("?") ? hash.split("?")[1] : "";
  return new URLSearchParams(qs).get(name) ?? undefined;
}

export default function EntityListPage({ params, entity }: { params: { eventId: string }; entity: Entity }) {
  const eventId = params.eventId;
  const initialGroup = useUrlParam("group") ?? "all";

  const agg = useQuery<ExpoAggregate | undefined>({
    queryKey: ["expo-aggregate", Number(eventId)],
    queryFn: () => buildExpoAggregate(eventId),
    enabled: isInsideBitrix() && Boolean(eventId),
  });

  const allColumns = entity === "lead" ? LEAD_COLUMNS : DEAL_COLUMNS;
  const [columns, setColumns] = useState<Set<string>>(
    () => new Set(allColumns.filter((c) => c.default).map((c) => c.key)),
  );
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>(initialGroup);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const rows = entity === "lead" ? agg.data?.leads ?? [] : agg.data?.deals ?? [];
  const stats = entity === "lead" ? agg.data?.leadStats : agg.data?.dealStats;
  const groupLabels = entity === "lead"
    ? (LEAD_GROUP_LABELS as Record<string, string>)
    : (DEAL_GROUP_LABELS as Record<string, string>);

  const filteredGroups = useMemo(() => {
    if (!stats) return [] as { key: string; label: string; rows: CrmItem[] }[];
    const byGroup = stats.byGroup as Record<string, CrmItem[]>;
    const keys = Object.keys(groupLabels);
    const lower = search.trim().toLocaleLowerCase("ru-RU");
    return keys
      .filter((key) => group === "all" || key === group)
      .map((key) => {
        const list = (byGroup[key] ?? []).filter((row) => {
          if (!lower) return true;
          const title = String(row.TITLE ?? row.title ?? "").toLocaleLowerCase("ru-RU");
          const id = String(row.ID ?? row.id ?? "");
          return title.includes(lower) || id.includes(lower);
        });
        return { key, label: groupLabels[key], rows: list };
      });
  }, [stats, groupLabels, group, search]);

  const visibleColumns = allColumns.filter((c) => columns.has(c.key));

  return (
    <Shell>
      <div className="mb-4 flex items-center gap-2">
        <Link href={`/event/${eventId}`}>
          <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            К сводке выставки
          </a>
        </Link>
      </div>

      <PageTitle
        eyebrow={entity === "lead" ? "Лиды" : "Сделки"}
        title={agg.data?.expo.title ?? `Выставка #${eventId}`}
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[auto_1fr_auto]">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-[220px]" data-testid="select-group"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {Object.entries(groupLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Поиск по названию или ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-columns">Колонки ({columns.size})</Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px]">
              <div className="grid gap-2">
                {allColumns.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={columns.has(col.key)}
                      onCheckedChange={(checked) => {
                        setColumns((current) => {
                          const next = new Set(current);
                          if (checked) next.add(col.key);
                          else next.delete(col.key);
                          return next;
                        });
                      }}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {entity === "lead" ? "Лиды" : "Сделки"} ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agg.isLoading ? (
            <LoadingRows />
          ) : agg.isError ? (
            <Empty text={`Ошибка Bitrix24 API: ${String((agg.error as Error)?.message ?? agg.error)}`} />
          ) : !rows.length ? (
            <Empty text={entity === "lead" ? "Связанных лидов не найдено." : "Связанных сделок не найдено."} />
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((grp) => (
                <div key={grp.key} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(grp.key)) next.delete(grp.key);
                        else next.add(grp.key);
                        return next;
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                    data-testid={`group-toggle-${grp.key}`}
                  >
                    <span className="flex items-center gap-2">
                      {collapsed.has(grp.key) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      {grp.label}
                      <span className="text-xs text-muted-foreground">{grp.rows.length}</span>
                    </span>
                  </button>
                  {!collapsed.has(grp.key) && (
                    grp.rows.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground">Нет записей в группе.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                              {visibleColumns.map((col) => (
                                <th key={col.key} className="px-3 py-2">{col.label}</th>
                              ))}
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {grp.rows.map((row) => {
                              const id = String(row.ID ?? row.id ?? "");
                              return (
                                <tr key={id} className="border-b last:border-0 hover:bg-accent/40" data-testid={`row-${entity}-${id}`}>
                                  {visibleColumns.map((col) => (
                                    <td key={col.key} className="px-3 py-2">
                                      {col.render ? col.render(row) : formatValue(row[col.key])}
                                    </td>
                                  ))}
                                  <td className="px-3 py-2 text-right">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        openBitrixPath(
                                          entity === "lead"
                                            ? `/crm/lead/details/${id}/`
                                            : `/crm/deal/details/${id}/`,
                                        )
                                      }
                                      data-testid={`button-open-${entity}-${id}`}
                                    >
                                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                      Открыть
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
