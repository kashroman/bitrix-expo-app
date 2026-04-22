import { useMemo, useState } from "react";
import { PHASE_COLORS } from "@/lib/config";
import { ExpoItem } from "@/lib/expo-data";
import { parseDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function CalendarView({ expos, onSelect }: { expos: ExpoItem[]; onSelect: (expo: ExpoItem) => void }) {
  const [cursor, setCursor] = useState(() => {
    for (const expo of expos) {
      const d = parseDate(expo.expoStart);
      if (d) return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthStart = cursor;
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  const day = (monthStart.getDay() + 6) % 7;
  gridStart.setDate(monthStart.getDate() - day);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  const events = useMemo(() => {
    return expos
      .map((expo) => {
        const start = parseDate(expo.installStart) ?? parseDate(expo.expoStart);
        const end = parseDate(expo.dismantleEnd) ?? parseDate(expo.expoEnd) ?? start;
        return start && end ? { expo, start, end } : null;
      })
      .filter(Boolean) as { expo: ExpoItem; start: Date; end: Date }[];
  }, [expos]);

  const eventsForDay = (d: Date) =>
    events.filter((ev) => {
      const time = d.getTime();
      return time >= stripTime(ev.start).getTime() && time <= stripTime(ev.end).getTime();
    });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">
          {cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            const now = new Date();
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
          }}>
            Сегодня
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px rounded-lg border bg-border text-xs">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <div key={d} className="bg-muted px-2 py-1 text-center font-medium text-muted-foreground">{d}</div>
        ))}
        {days.map((d) => {
          const inMonth = d.getMonth() === monthStart.getMonth();
          const dayEvents = eventsForDay(d).slice(0, 3);
          return (
            <div
              key={d.toISOString()}
              className={`min-h-[88px] bg-card p-1.5 ${inMonth ? "" : "opacity-50"}`}
            >
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">{d.getDate()}</div>
              <div className="space-y-0.5">
                {dayEvents.map((ev) => {
                  const phase = phaseOn(d, ev.expo);
                  return (
                    <button
                      key={ev.expo.id}
                      type="button"
                      onClick={() => onSelect(ev.expo)}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] text-white"
                      style={{ background: PHASE_COLORS[phase] }}
                      title={ev.expo.title}
                      data-testid={`calendar-event-${ev.expo.id}`}
                    >
                      {ev.expo.title}
                    </button>
                  );
                })}
                {eventsForDay(d).length > 3 && (
                  <div className="text-[10px] text-muted-foreground">+{eventsForDay(d).length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Dot color={PHASE_COLORS.mount} label="Монтаж" />
        <Dot color={PHASE_COLORS.expo} label="Проведение" />
        <Dot color={PHASE_COLORS.dismantle} label="Демонтаж" />
      </div>
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}

function stripTime(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function phaseOn(d: Date, expo: ExpoItem): "mount" | "expo" | "dismantle" {
  const t = d.getTime();
  const expoStart = parseDate(expo.expoStart);
  const expoEnd = parseDate(expo.expoEnd);
  const mountStart = parseDate(expo.installStart);
  const mountEnd = parseDate(expo.installEnd) ?? expoStart;
  const dismantleStart = parseDate(expo.dismantleStart) ?? expoEnd;
  const dismantleEnd = parseDate(expo.dismantleEnd);
  if (mountStart && mountEnd && t >= stripTime(mountStart).getTime() && t < stripTime(mountEnd).getTime()) return "mount";
  if (dismantleStart && dismantleEnd && t > stripTime(dismantleStart).getTime() && t <= stripTime(dismantleEnd).getTime()) return "dismantle";
  return "expo";
}
