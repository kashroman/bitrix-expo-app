import {
  DEAL_STATUS_COLORS,
  matchDealStatus,
} from "@/lib/config";

const NEUTRAL_BAR_COLOR = "#94a3b8";
const STAGE_FALLBACK_PALETTE = [
  "#a855f7",
  "#0ea5e9",
  "#f97316",
  "#14b8a6",
  "#ec4899",
  "#22c55e",
  "#facc15",
  "#ef4444",
  "#6366f1",
  "#84cc16",
];

export function normalizeCrmStageColor(value: string | undefined | null): string | undefined {
  const color = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color) || /^#[0-9a-f]{3}$/i.test(color)) {
    return color;
  }
  return undefined;
}

export function stageFallbackColor(stageId: string | undefined | null): string {
  const id = String(stageId ?? "").trim();
  if (!id) return NEUTRAL_BAR_COLOR;
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return STAGE_FALLBACK_PALETTE[hash % STAGE_FALLBACK_PALETTE.length];
}

/** One palette resolver shared by the stage filter, Gantt bars and legend. */
export function stageDisplayColor(
  stageId: string | undefined | null,
  stageTitle?: string,
  crmColor?: string,
): string {
  const nativeColor = normalizeCrmStageColor(crmColor);
  if (nativeColor) return nativeColor;
  const known = matchDealStatus(stageId, stageTitle);
  if (known) return DEAL_STATUS_COLORS[known];
  return stageFallbackColor(stageId);
}
