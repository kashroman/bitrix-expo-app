import { useMemo } from "react";
import { PHASE_COLORS } from "@/lib/config";
import { ExpoItem } from "@/lib/expo-data";
import { formatDate, parseDate } from "@/lib/format";

type Phase = { key: "mount" | "expo" | "dismantle"; start?: Date; end?: Date };

function phasesOf(expo: ExpoItem): Phase[] {
  const event: Phase = {
    key: "expo",
    start: parseDate(expo.expoStart),
    end: parseDate(expo.expoEnd),
  };
  const mountStart = parseDate(expo.installStart);
  const mountEnd = parseDate(expo.installEnd) ?? event.start;
  const mount: Phase = { key: "mount", start: mountStart, end: mountEnd };
  const dismantleStart = parseDate(expo.dismantleStart) ?? event.end;
  const dismantleEnd = parseDate(expo.dismantleEnd) ?? dismantleStart;
  const dismantle: Phase = { key: "dismantle", start: dismantleStart, end: dismantleEnd };
  return [mount, event, dismantle].filter((phase) => phase.start && phase.end);
}

export function GanttTimeline({
  expos,
  onSelect,
  renderRight,
}: {
  expos: ExpoItem[];
  onSelect: (expo: ExpoItem) => void;
  renderRight?: (expo: ExpoItem) => React.ReactNode;
}) {
  const { minDate, maxDate, span } = useMemo(() => {
    let min: number | undefined;
    let max: number | undefined;
    for (const expo of expos) {
      for (const phase of phasesOf(expo)) {
        const s = phase.start?.getTime();
        const e = phase.end?.getTime();
        if (s !== undefined) min = min === undefined ? s : Math.min(min, s);
        if (e !== undefined) max = max === undefined ? e : Math.max(max, e);
      }
    }
    if (min === undefined || max === undefined || min === max) {
      const now = Date.now();
      return { minDate: new Date(now - 30 * 86400000), maxDate: new Date(now + 60 * 86400000), span: 90 * 86400000 };
    }
    const pad = Math.max((max - min) * 0.05, 86400000 * 3);
    return { minDate: new Date(min - pad), maxDate: new Date(max + pad), span: max - min + 2 * pad };
  }, [expos]);

  if (!expos.length) {
    return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Нет выставок для отображения.</div>;
  }

  const months = monthMarkers(minDate, maxDate);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[240px_1fr] gap-3 border-b pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Выставка</span>
          <div className="relative h-5">
            {months.map((m, idx) => (
              <span
                key={idx}
                className="absolute top-0 border-l border-border pl-1 text-[10px] text-muted-foreground"
                style={{ left: `${((m.getTime() - minDate.getTime()) / span) * 100}%` }}
              >
                {m.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" })}
              </span>
            ))}
          </div>
        </div>
        <div className="divide-y">
          {expos.map((expo) => (
            <button
              key={expo.id}
              type="button"
              onClick={() => onSelect(expo)}
              className="grid w-full grid-cols-[240px_1fr] items-center gap-3 py-3 text-left hover:bg-accent/40"
              data-testid={`gantt-row-${expo.id}`}
            >
              <div className="min-w-0 pr-2">
                <div className="truncate text-sm font-medium">{expo.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatDate(expo.expoStart)} — {formatDate(expo.expoEnd)}
                </div>
                {renderRight ? <div className="mt-1">{renderRight(expo)}</div> : null}
              </div>
              <div className="relative h-8">
                {phasesOf(expo).map((phase) => {
                  if (!phase.start || !phase.end) return null;
                  const left = ((phase.start.getTime() - minDate.getTime()) / span) * 100;
                  const width = Math.max(((phase.end.getTime() - phase.start.getTime()) / span) * 100, 0.5);
                  return (
                    <span
                      key={phase.key}
                      className="absolute top-1.5 h-5 rounded"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: PHASE_COLORS[phase.key],
                        opacity: phase.key === "expo" ? 0.95 : 0.8,
                      }}
                      title={`${phaseLabel(phase.key)}: ${formatDate(phase.start.toISOString())} — ${formatDate(phase.end.toISOString())}`}
                    />
                  );
                })}
              </div>
            </button>
          ))}
        </div>
        <GanttLegend />
      </div>
    </div>
  );
}

function phaseLabel(key: "mount" | "expo" | "dismantle") {
  return key === "mount" ? "Монтаж" : key === "expo" ? "Проведение" : "Демонтаж";
}

export function GanttLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <LegendDot color={PHASE_COLORS.mount} label="Монтаж" />
      <LegendDot color={PHASE_COLORS.expo} label="Проведение" />
      <LegendDot color={PHASE_COLORS.dismantle} label="Демонтаж" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-4 rounded" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function monthMarkers(min: Date, max: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(min.getFullYear(), min.getMonth(), 1);
  while (cur <= max) {
    out.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}
