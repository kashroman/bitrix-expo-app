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

export const EXPO_DATE_FIELDS = {
  eventStart: "ufCrm8_1766066484758",
  eventEnd: "ufCrm8_1766066501630",
  mountStart: undefined as string | undefined,
  mountEnd: undefined as string | undefined,
  dismantleStart: undefined as string | undefined,
  dismantleEnd: undefined as string | undefined,
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
// Montage/dismantle are very light transparent gray; exhibition working days
// are a stronger semi-transparent gray so the event span stands out.
export const PHASE_FILLS = {
  mount: "rgba(100, 116, 139, 0.12)",
  expo: "rgba(71, 85, 105, 0.32)",
  dismantle: "rgba(100, 116, 139, 0.12)",
};

// --- Deal status bars inside Gantt exhibition rows ---
// The three statuses the user asked to visualize on the monthly Gantt:
//   signingContract = "Подписываем договор" → yellow
//   building        = "Строим"              → blue
//   projectCompleted = "Проект завершён"    → green
// Stage IDs were not confirmed from Bitrix, so the config stays null by default
// and the UI falls back to case-insensitive name matching against the deal's
// stage title. Set the explicit Bitrix stage ID (e.g. "C5:PREPAYMENT_INVOICE")
// to pin the mapping once confirmed.
export type DealStatusKey = "signingContract" | "building" | "projectCompleted";

export const dealStageIds: Record<DealStatusKey, string | null> = {
  signingContract: null,
  building: null,
  projectCompleted: null,
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
