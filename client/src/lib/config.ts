export const EXPO_ENTITY_TYPE_ID = 1050;

export const EXPO_LINK_FIELD = "PARENT_ID_1050";

// Manual override for the custom "Выставка (календарь)" link field codes.
// Confirmed from Bitrix24 diagnostics (type=crm, DYNAMIC_1050="Y"):
//   lead: UF_CRM_1770132666 — listLabel/formLabel "Выставка (календарь)", LEAD=null
//   deal: UF_CRM_6989BC521C964 — listLabel/formLabel "Выставка (календарь)", LEAD="N"
// Set to null to fall back to automatic discovery via findLinkCandidates().
export const leadExpoFieldCode: string | null = "UF_CRM_1770132666";
export const dealExpoFieldCode: string | null = "UF_CRM_6989BC521C964";

export function manualExpoFieldCode(entity: "lead" | "deal"): string | null {
  return entity === "lead" ? leadExpoFieldCode : dealExpoFieldCode;
}

// Manual override for the expo-link filter value format. Confirmed from
// Bitrix24 diagnostics on event id=1274:
//   lead UF_CRM_1770132666  · numeric  · count=1
//   deal UF_CRM_6989BC521C964 · numeric · count=1 (sample id=3108, value=[1274])
// Supported labels must match filterFormats() in expo-link.ts:
//   "numeric" | "string" | "T1050_<id>" | "DYNAMIC_1050_<id>"
// Set to null to fall back to full format probing.
export type ExpoLinkFormatOverride =
  | "numeric"
  | "string"
  | "T1050_<id>"
  | "DYNAMIC_1050_<id>"
  | null;

export const leadExpoFieldFormat: ExpoLinkFormatOverride = "numeric";
export const dealExpoFieldFormat: ExpoLinkFormatOverride = "numeric";

export function manualExpoFieldFormat(entity: "lead" | "deal"): ExpoLinkFormatOverride {
  return entity === "lead" ? leadExpoFieldFormat : dealExpoFieldFormat;
}

// Pinned smart-process "Выставки" (entityTypeId 1050, CRM_8) date-field codes.
// Verified live in Bitrix24 admin → smart-process field settings on 2026-05-06.
// Original UF names (UF_CRM_8_*) are kept as fallbacks below — both forms are
// queried by the runtime registry/normalizer so the app works regardless of
// which casing the REST response uses.
//   eventStart      ufCrm8_1766066484758
//   eventEnd        ufCrm8_1766066501630
//   mountStart      ufCrm8_1778070067219  (multiple=yes in UI — see normalizer)
//   mountEnd        ufCrm8_1778070672
//   dismantleStart  ufCrm8_1778070708
//   dismantleEnd    ufCrm8_1778070734
export const EXPO_DATE_FIELDS = {
  eventStart: "ufCrm8_1766066484758",
  eventEnd: "ufCrm8_1766066501630",
  mountStart: "ufCrm8_1778070067219" as string | undefined,
  mountEnd: "ufCrm8_1778070672" as string | undefined,
  dismantleStart: "ufCrm8_1778070708" as string | undefined,
  dismantleEnd: "ufCrm8_1778070734" as string | undefined,
};

// Original UF_CRM_8_* names — Bitrix REST sometimes returns user fields under
// the original (uppercased) form depending on useOriginalUfNames flag and the
// item shape. Kept alongside the camelCase pins so pick() can read either.
export const EXPO_DATE_FIELDS_ORIGINAL = {
  eventStart: "UF_CRM_8_1766066484758" as string | undefined,
  eventEnd: "UF_CRM_8_1766066501630" as string | undefined,
  mountStart: "UF_CRM_8_1778070067219" as string | undefined,
  mountEnd: "UF_CRM_8_1778070672" as string | undefined,
  dismantleStart: "UF_CRM_8_1778070708" as string | undefined,
  dismantleEnd: "UF_CRM_8_1778070734" as string | undefined,
};

export const EXPO_INFO_FIELDS = {
  venue: undefined as string | undefined,
  city: undefined as string | undefined,
};

export type LeadGroupKey = "new" | "inWork" | "declined" | "success";
export type DealGroupKey = "early" | "inWork" | "refusal" | "lostCompetition" | "won";

export type StatusGroups = {
  lead: Record<LeadGroupKey, string[]>;
  deal: Record<DealGroupKey, string[]>;
};

export const statusGroups: StatusGroups = {
  lead: {
    new: ["NEW"],
    inWork: ["IN_PROCESS", "PROCESSED"],
    declined: ["JUNK"],
    success: ["CONVERTED"],
  },
  deal: {
    early: ["NEW", "PREPARATION"],
    inWork: ["PREPAYMENT_INVOICE", "EXECUTING"],
    refusal: ["LOSE"],
    lostCompetition: ["APOLOGY"],
    won: ["FINAL_INVOICE", "WON"],
  },
};

export const LEAD_GROUP_LABELS: Record<LeadGroupKey, string> = {
  new: "Новые",
  inWork: "В работе",
  declined: "Отказные",
  success: "Успешные",
};

export const DEAL_GROUP_LABELS: Record<DealGroupKey, string> = {
  early: "Начало",
  inWork: "В работе",
  refusal: "Отказ от участия",
  lostCompetition: "Проиграли в конкурсе",
  won: "Выиграли",
};

export const LEAD_GROUP_COLORS: Record<LeadGroupKey, string> = {
  new: "#3b82f6",
  inWork: "#f59e0b",
  declined: "#ef4444",
  success: "#10b981",
};

export const DEAL_GROUP_COLORS: Record<DealGroupKey, string> = {
  early: "#64748b",
  inWork: "#f59e0b",
  refusal: "#ef4444",
  lostCompetition: "#a855f7",
  won: "#10b981",
};

export const PHASE_COLORS = {
  mount: "#f59e0b",
  expo: "#2563eb",
  dismantle: "#0891b2",
};

// Monthly Gantt phase fills (background layers behind deal bars).
// Phase semantics use almost-transparent traffic-light colors so the spans
// stay subtle but distinguishable: yellow = montage, green = event,
// red = dismantle.
export const PHASE_FILLS = {
  mount: "rgba(250, 204, 21, 0.18)",
  expo: "rgba(34, 197, 94, 0.18)",
  dismantle: "rgba(239, 68, 68, 0.18)",
};

// --- Deal status bars inside Gantt exhibition rows ---
// The three statuses the user asked to visualize on the monthly Gantt:
//   signingContract = "Подписываем договор" → yellow
//   building        = "Строим"              → blue
//   projectCompleted = "Проект завершён"    → green
// Stage IDs verified from live Bitrix24 deal cards:
//   signingContract ("Подписание договора")  → STAGE_ID "8"
//   building        ("Строим")                → STAGE_ID "9"
//   projectCompleted ("Проект завершён")      → STAGE_ID "WON"
// Name-matching fallbacks below still apply if a deal's stage ID does not
// match one of these pinned values.
export type DealStatusKey = "signingContract" | "building" | "projectCompleted";

export const dealStageIds: Record<DealStatusKey, string | null> = {
  signingContract: "8",
  building: "9",
  projectCompleted: "WON",
};

export const DEAL_STATUS_LABELS: Record<DealStatusKey, string> = {
  signingContract: "Подписываем договор",
  building: "Строим",
  projectCompleted: "Проект завершён",
};

export const DEAL_STATUS_COLORS: Record<DealStatusKey, string> = {
  signingContract: "#eab308", // yellow-500
  building: "#2563eb", // blue-600
  projectCompleted: "#16a34a", // green-600
};

// Order drives stacking inside a row and legend order.
export const DEAL_STATUS_ORDER: DealStatusKey[] = [
  "signingContract",
  "building",
  "projectCompleted",
];

// Stage IDs that qualify a deal for the "График застройки" (build schedule)
// tab. A deal whose normalized stage tail equals one of these is shown as a
// colored bar inside the exhibition's row. Default = ["8", "9", "WON"].
// Override via VITE_BUILD_SCHEDULE_STAGE_IDS (comma-separated) when the
// account uses different pinned IDs. The Bitrix deal funnel does not expose
// "and-higher" ordering through REST without category-specific stage lists,
// so this list is treated as an explicit whitelist.
function readBuildScheduleStageIdsEnv(): string[] | undefined {
  const raw =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string | undefined> }).env
        ?.VITE_BUILD_SCHEDULE_STAGE_IDS) ||
    undefined;
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const BUILD_SCHEDULE_STAGE_IDS: string[] =
  readBuildScheduleStageIdsEnv() ?? ["8", "9", "WON"];

export function matchBuildScheduleStage(
  stageId: string | undefined | null,
): string | undefined {
  if (stageId === undefined || stageId === null) return undefined;
  const text = String(stageId).trim();
  if (!text) return undefined;
  const tail = text.split(":").pop() ?? text;
  for (const pinned of BUILD_SCHEDULE_STAGE_IDS) {
    if (pinned === text || pinned === tail) return pinned;
  }
  return undefined;
}

export function normalizeStageText(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

// Partial-token candidate matcher used by diagnostics to surface stages whose
// titles look like likely candidates for the three tracked statuses even when
// the strict matcher rejects them.
export function candidateDealStatusByName(
  title: string | undefined | null,
): DealStatusKey | undefined {
  if (!title) return undefined;
  const n = normalizeStageText(String(title));
  if (!n) return undefined;
  if (n.includes("подпис") || n.includes("договор")) return "signingContract";
  if (n.includes("стро")) return "building";
  if (n.includes("заверш") || n.includes("законч") || n.includes("проект")) {
    return "projectCompleted";
  }
  return undefined;
}

// Normalized keywords used to match a stage NAME to one of the three
// supported statuses when dealStageIds are not pinned.
const STATUS_NAME_MATCHERS: Record<DealStatusKey, (normalized: string) => boolean> = {
  signingContract: (n) => n.includes("подпис") && n.includes("договор"),
  building: (n) => n === "строим" || n.startsWith("строим ") || n.includes(" строим"),
  projectCompleted: (n) =>
    (n.includes("проект") && (n.includes("заверш") || n.includes("законч"))) ||
    n === "проект завершен",
};

export function matchDealStatusByName(title: string | undefined | null): DealStatusKey | undefined {
  if (!title) return undefined;
  const n = normalizeStageText(String(title));
  if (!n) return undefined;
  for (const key of DEAL_STATUS_ORDER) {
    if (STATUS_NAME_MATCHERS[key](n)) return key;
  }
  return undefined;
}

export function matchDealStatus(
  stageId: string | undefined | null,
  stageTitle: string | undefined | null,
): DealStatusKey | undefined {
  const id = String(stageId ?? "").trim();
  if (id) {
    for (const key of DEAL_STATUS_ORDER) {
      const pinned = dealStageIds[key];
      if (pinned && (pinned === id || pinned === id.split(":").pop())) return key;
    }
  }
  return matchDealStatusByName(stageTitle);
}

export function groupForLead(statusId: unknown): LeadGroupKey | undefined {
  const id = String(statusId ?? "");
  if (!id) return undefined;
  for (const key of Object.keys(statusGroups.lead) as LeadGroupKey[]) {
    if (statusGroups.lead[key].includes(id)) return key;
  }
  return undefined;
}

export function groupForDeal(stageId: unknown): DealGroupKey | undefined {
  const id = String(stageId ?? "");
  if (!id) return undefined;
  for (const key of Object.keys(statusGroups.deal) as DealGroupKey[]) {
    if (statusGroups.deal[key].includes(id)) return key;
  }
  const normalized = id.split(":").pop() ?? id;
  for (const key of Object.keys(statusGroups.deal) as DealGroupKey[]) {
    if (statusGroups.deal[key].includes(normalized)) return key;
  }
  return undefined;
}

export function fallbackLeadGroup(statusTitle?: string): LeadGroupKey {
  const title = (statusTitle ?? "").toLocaleLowerCase("ru-RU");
  if (!title) return "new";
  if (title.includes("нов")) return "new";
  if (title.includes("качествен") || title.includes("обработ") || title.includes("работ")) return "inWork";
  if (title.includes("отказ") || title.includes("некачествен") || title.includes("junk")) return "declined";
  if (title.includes("конверт") || title.includes("успех") || title.includes("завершен")) return "success";
  return "inWork";
}

export function fallbackDealGroup(stageTitle?: string): DealGroupKey {
  const title = (stageTitle ?? "").toLocaleLowerCase("ru-RU");
  if (!title) return "early";
  if (title.includes("подпис") || title.includes("выигра") || title.includes("won") || title.includes("оплач")) return "won";
  if (title.includes("отказ от участ")) return "refusal";
  if (title.includes("проигра") || title.includes("конкурс") || title.includes("apology")) return "lostCompetition";
  if (title.includes("собира") || title.includes("нов") || title.includes("подготов")) return "early";
  return "inWork";
}
