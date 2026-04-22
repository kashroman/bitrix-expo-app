import { DEAL_GROUP_COLORS, DEAL_GROUP_LABELS, DealGroupKey, LEAD_GROUP_COLORS, LEAD_GROUP_LABELS, LeadGroupKey } from "@/lib/config";
import { DealStats, LeadStats } from "@/lib/expo-data";

type Entry<K extends string> = { key: K; label: string; value: number; color: string };

export function LeadFunnel({ stats, onSelect }: { stats: LeadStats; onSelect?: (group: LeadGroupKey) => void }) {
  const entries: Entry<LeadGroupKey>[] = (["new", "inWork", "declined", "success"] as LeadGroupKey[]).map((key) => ({
    key,
    label: LEAD_GROUP_LABELS[key],
    value: stats[key],
    color: LEAD_GROUP_COLORS[key],
  }));
  return <Funnel total={stats.total} entries={entries} onSelect={onSelect} label="лидов" />;
}

export function DealFunnel({ stats, onSelect }: { stats: DealStats; onSelect?: (group: DealGroupKey) => void }) {
  const entries: Entry<DealGroupKey>[] = (["early", "inWork", "refusal", "lostCompetition", "won"] as DealGroupKey[]).map((key) => ({
    key,
    label: DEAL_GROUP_LABELS[key],
    value: stats[key],
    color: DEAL_GROUP_COLORS[key],
  }));
  return <Funnel total={stats.total} entries={entries} onSelect={onSelect} label="сделок" />;
}

function Funnel<K extends string>({
  total,
  entries,
  onSelect,
  label,
}: {
  total: number;
  entries: Entry<K>[];
  onSelect?: (key: K) => void;
  label: string;
}) {
  const max = Math.max(total, 1, ...entries.map((e) => e.value));
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Всего {label}</span>
        <span className="text-xl font-semibold">{total}</span>
      </div>
      <div className="space-y-1.5">
        {entries.map((entry) => {
          const pct = Math.round((entry.value / max) * 100);
          const clickable = Boolean(onSelect) && entry.value > 0;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => clickable && onSelect?.(entry.key)}
              disabled={!clickable}
              className={`group grid w-full grid-cols-[140px_1fr_48px] items-center gap-2 rounded-md border p-2 text-left text-xs ${
                clickable ? "hover:bg-accent" : "opacity-80"
              }`}
              data-testid={`funnel-segment-${entry.key}`}
            >
              <span className="truncate font-medium">{entry.label}</span>
              <span className="relative h-3 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.max(pct, entry.value > 0 ? 4 : 0)}%`, background: entry.color }}
                />
              </span>
              <span className="text-right font-semibold tabular-nums">{entry.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
