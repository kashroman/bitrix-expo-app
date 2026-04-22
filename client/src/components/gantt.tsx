import { useMemo } from "react";
import { PHASE_COLORS } from "@/lib/config";
import { ExpoItem } from "@/lib/expo-data";
import { formatDate, parseDate } from "@/lib/format";

type Phase = { key: "mount" | "expo" | "dismantle"; start?: Date; end?: Date };

const LEFT_COL_PX = 260;
const MIN_PX_PER_DAY = 6;
const MAX_PX_PER_DAY = 28;
const DEFAULT_PX_PER_DAY = 10;
const ROW_HEIGHT = 48;

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
  const { minDate, maxDate, span, pxPerDay, timelineWidth, months } = useMemo(() => {
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
    const now = Date.now();
    let minMs: number;
    let maxMs: number;
    if (min === undefined || max === undefined || min === max) {
      minMs = now - 30 * 86400000;
      maxMs = now + 60 * 86400000;
    } else {
      const pad = Math.max((max - min) * 0.02, 86400000 * 2);
      minMs = min - pad;
      maxMs = max + pad;
    }
    const minD = new Date(minMs);
    const maxD = new Date(maxMs);
    const spanMs = maxMs - minMs;
    const days = Math.max(1, Math.round(spanMs / 86400000));
    // Target: 1400..4200 px. Clamp per-day.
    let pxPd = Math.max(MIN_PX_PER_DAY, Math.min(MAX_PX_PER_DAY, 1400 / days));
    if (days < 120) pxPd = Math.max(pxPd, DEFAULT_PX_PER_DAY);
    const width = Math.max(720, Math.round(days * pxPd));
    return {
      minDate: minD,
      maxDate: maxD,
      span: spanMs,
      pxPerDay: pxPd,
      timelineWidth: width,
      months: monthMarkers(minD, maxD),
    };
  }, [expos]);

  if (!expos.length) {
    return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Нет выставок для отображения.</div>;
  }

  // Limit month tick label density: show full label only every N months if too narrow
  const avgMonthPx = months.length > 1 ? timelineWidth / months.length : timelineWidth;
  const monthLabelStep = avgMonthPx < 48 ? 3 : avgMonthPx < 80 ? 2 : 1;

  return (
    <div className="relative overflow-x-auto overscroll-x-contain rounded-md border bg-background">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex border-b bg-background/95 backdrop-blur"
        style={{ width: `${LEFT_COL_PX + timelineWidth}px` }}
      >
        <div
          className="sticky left-0 z-30 flex items-center border-r bg-background px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          style={{ width: `${LEFT_COL_PX}px`, minWidth: `${LEFT_COL_PX}px` }}
        >
          Выставка
        </div>
        <div className="relative h-9" style={{ width: `${timelineWidth}px` }}>
          {months.map((m, idx) => {
            const leftPct = ((m.getTime() - minDate.getTime()) / span) * 100;
            const showLabel = idx % monthLabelStep === 0;
            return (
              <div
                key={idx}
                className="absolute top-0 bottom-0 flex items-end border-l border-border/60"
                style={{ left: `${leftPct}%` }}
              >
                {showLabel && (
                  <span className="whitespace-nowrap px-1 pb-1 text-[10px] text-muted-foreground">
                    {m.toLocaleDateString("ru-RU", {
                      month: "short",
                      year: "2-digit",
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      <div
        className="relative"
        style={{ width: `${LEFT_COL_PX + timelineWidth}px` }}
      >
        {expos.map((expo, rowIndex) => (
          <div
            key={expo.id}
            className={`flex items-stretch border-b ${rowIndex % 2 === 1 ? "bg-muted/20" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelect(expo)}
              className="sticky left-0 z-10 flex flex-col justify-center border-r bg-background px-3 py-2 text-left text-sm hover:bg-accent/60"
              style={{ width: `${LEFT_COL_PX}px`, minWidth: `${LEFT_COL_PX}px`, minHeight: `${ROW_HEIGHT}px` }}
              data-testid={`gantt-row-${expo.id}`}
              title={expo.title}
            >
              <div className="truncate font-medium">{expo.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {formatDate(expo.expoStart)} — {formatDate(expo.expoEnd)}
              </div>
              {renderRight ? <div className="mt-0.5 truncate">{renderRight(expo)}</div> : null}
            </button>
            <button
              type="button"
              onClick={() => onSelect(expo)}
              className="relative flex-shrink-0 hover:bg-accent/30"
              style={{ width: `${timelineWidth}px`, minHeight: `${ROW_HEIGHT}px` }}
              aria-label={`Открыть ${expo.title}`}
            >
              {/* Month grid background */}
              {months.map((m, idx) => (
                <div
                  key={idx}
                  className="absolute top-0 bottom-0 border-l border-border/40"
                  style={{
                    left: `${((m.getTime() - minDate.getTime()) / span) * 100}%`,
                  }}
                />
              ))}
              {phasesOf(expo).map((phase) => {
                if (!phase.start || !phase.end) return null;
                const leftPct = ((phase.start.getTime() - minDate.getTime()) / span) * 100;
                const widthPct = Math.max(
                  ((phase.end.getTime() - phase.start.getTime()) / span) * 100,
                  0.3,
                );
                return (
                  <span
                    key={phase.key}
                    className="absolute rounded"
                    style={{
                      top: "10px",
                      height: `${ROW_HEIGHT - 20}px`,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: "3px",
                      background: PHASE_COLORS[phase.key],
                      opacity: phase.key === "expo" ? 0.95 : 0.8,
                    }}
                    title={`${phaseLabel(phase.key)}: ${formatDate(phase.start.toISOString())} — ${formatDate(phase.end.toISOString())}`}
                  />
                );
              })}
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <LegendDot color={PHASE_COLORS.mount} label="Монтаж" />
        <LegendDot color={PHASE_COLORS.expo} label="Проведение" />
        <LegendDot color={PHASE_COLORS.dismantle} label="Демонтаж" />
        <span className="ml-auto hidden md:inline">
          {expos.length} выставок · {Math.round(pxPerDay * 10) / 10} px/день
        </span>
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
