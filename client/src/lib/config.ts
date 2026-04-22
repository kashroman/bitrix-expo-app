export const EXPO_ENTITY_TYPE_ID = 1050;

export const EXPO_LINK_FIELD = "PARENT_ID_1050";

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
