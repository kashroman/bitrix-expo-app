import { callBx, CrmItem, listAllBx } from "./bitrix";
import {
  DEAL_GROUP_LABELS,
  DealGroupKey,
  EXPO_DATE_FIELDS,
  EXPO_ENTITY_TYPE_ID,
  EXPO_LINK_FIELD,
  LEAD_GROUP_LABELS,
  LeadGroupKey,
  fallbackDealGroup,
  fallbackLeadGroup,
  groupForDeal,
  groupForLead,
} from "./config";

export type ExpoItem = {
  id: number;
  title: string;
  assignedById?: number;
  createdTime?: string;
  updatedTime?: string;
  responsibleId?: number;
  venue?: string;
  city?: string;
  installStart?: string;
  installEnd?: string;
  expoStart?: string;
  expoEnd?: string;
  dismantleStart?: string;
  dismantleEnd?: string;
  raw: CrmItem;
};

export type LeadStats = {
  total: number;
  new: number;
  inWork: number;
  declined: number;
  success: number;
  byGroup: Record<LeadGroupKey, CrmItem[]>;
};

export type DealStats = {
  total: number;
  early: number;
  inWork: number;
  refusal: number;
  lostCompetition: number;
  won: number;
  byGroup: Record<DealGroupKey, CrmItem[]>;
};

export type ExpoAggregate = {
  expo: ExpoItem;
  leadStats: LeadStats;
  dealStats: DealStats;
  leads: CrmItem[];
  deals: CrmItem[];
};

export type StatusRef = { id: string; title: string; entityId?: string };

const pick = (item: CrmItem, ...keys: (string | undefined)[]) => {
  for (const key of keys) {
    if (!key) continue;
    const direct = item[key];
    if (direct !== undefined && direct !== null && direct !== "") return direct;
    const upper = item[key.toUpperCase()];
    if (upper !== undefined && upper !== null && upper !== "") return upper;
    const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const camelVal = item[camel];
    if (camelVal !== undefined && camelVal !== null && camelVal !== "") return camelVal;
  }
  return undefined;
};

export function normalizeExpo(item: CrmItem): ExpoItem {
  const id = Number(item.id ?? item.ID ?? 0);
  const title = String(item.title ?? item.TITLE ?? `Выставка #${id}`);
  const expoStart = pick(item, EXPO_DATE_FIELDS.eventStart);
  const expoEnd = pick(item, EXPO_DATE_FIELDS.eventEnd);
  const installStart = pick(item, EXPO_DATE_FIELDS.mountStart);
  const installEnd = pick(item, EXPO_DATE_FIELDS.mountEnd);
  const dismantleStart = pick(item, EXPO_DATE_FIELDS.dismantleStart);
  const dismantleEnd = pick(item, EXPO_DATE_FIELDS.dismantleEnd);
  const responsible = pick(item, "assignedById", "ASSIGNED_BY_ID");

  return {
    id,
    title,
    assignedById: responsible ? Number(responsible) : undefined,
    responsibleId: responsible ? Number(responsible) : undefined,
    createdTime: pick(item, "createdTime", "CREATED_TIME") as string | undefined,
    updatedTime: pick(item, "updatedTime", "UPDATED_TIME") as string | undefined,
    venue: undefined,
    city: undefined,
    installStart: installStart ? String(installStart) : undefined,
    installEnd: installEnd ? String(installEnd) : undefined,
    expoStart: expoStart ? String(expoStart) : undefined,
    expoEnd: expoEnd ? String(expoEnd) : undefined,
    dismantleStart: dismantleStart ? String(dismantleStart) : undefined,
    dismantleEnd: dismantleEnd ? String(dismantleEnd) : undefined,
    raw: item,
  };
}

export async function fetchExpoList(): Promise<ExpoItem[]> {
  const items = await listAllBx<CrmItem>("crm.item.list", {
    entityTypeId: EXPO_ENTITY_TYPE_ID,
    select: ["*", "ufCrm*"],
    order: { id: "DESC" },
  });
  return items.map(normalizeExpo);
}

export async function fetchExpo(id: string | number): Promise<ExpoItem | undefined> {
  try {
    const data = await callBx<{ item: CrmItem }>("crm.item.get", {
      entityTypeId: EXPO_ENTITY_TYPE_ID,
      id,
      useOriginalUfNames: "N",
    });
    if (!data?.item) return undefined;
    return normalizeExpo(data.item);
  } catch {
    return undefined;
  }
}

export async function fetchLeadsByExpo(expoId: string | number): Promise<CrmItem[]> {
  const filters = [
    { [EXPO_LINK_FIELD]: expoId },
    { [`=${EXPO_LINK_FIELD}`]: expoId },
  ];
  for (const filter of filters) {
    try {
      const rows = await listAllBx<CrmItem>("crm.lead.list", {
        filter,
        select: [
          "ID",
          "TITLE",
          "STATUS_ID",
          "ASSIGNED_BY_ID",
          "DATE_CREATE",
          "DATE_MODIFY",
          "OPPORTUNITY",
          "CURRENCY_ID",
          "PHONE",
          "EMAIL",
          "NAME",
          "LAST_NAME",
          "SOURCE_ID",
          EXPO_LINK_FIELD,
        ],
        order: { ID: "DESC" },
      });
      if (rows.length) return rows;
    } catch {}
  }
  return [];
}

export async function fetchDealsByExpo(expoId: string | number): Promise<CrmItem[]> {
  const filters = [
    { [EXPO_LINK_FIELD]: expoId },
    { [`=${EXPO_LINK_FIELD}`]: expoId },
  ];
  for (const filter of filters) {
    try {
      const rows = await listAllBx<CrmItem>("crm.deal.list", {
        filter,
        select: [
          "ID",
          "TITLE",
          "STAGE_ID",
          "CATEGORY_ID",
          "ASSIGNED_BY_ID",
          "DATE_CREATE",
          "DATE_MODIFY",
          "OPPORTUNITY",
          "CURRENCY_ID",
          "COMPANY_ID",
          "CONTACT_ID",
          EXPO_LINK_FIELD,
        ],
        order: { ID: "DESC" },
      });
      if (rows.length) return rows;
    } catch {}
  }
  return [];
}

export async function fetchLeadById(id: string | number): Promise<CrmItem | undefined> {
  try {
    return await callBx<CrmItem>("crm.lead.get", { id });
  } catch {
    return undefined;
  }
}

export async function fetchDealById(id: string | number): Promise<CrmItem | undefined> {
  try {
    return await callBx<CrmItem>("crm.deal.get", { id });
  } catch {
    return undefined;
  }
}

export function computeLeadStats(leads: CrmItem[], leadStatusMap?: Map<string, string>): LeadStats {
  const byGroup: Record<LeadGroupKey, CrmItem[]> = {
    new: [],
    inWork: [],
    declined: [],
    success: [],
  };
  for (const lead of leads) {
    const statusId = pick(lead, "STATUS_ID", "statusId");
    let group = groupForLead(statusId);
    if (!group) {
      const title = leadStatusMap?.get(String(statusId ?? ""));
      group = fallbackLeadGroup(title);
    }
    byGroup[group].push(lead);
  }
  return {
    total: leads.length,
    new: byGroup.new.length,
    inWork: byGroup.inWork.length,
    declined: byGroup.declined.length,
    success: byGroup.success.length,
    byGroup,
  };
}

export function computeDealStats(deals: CrmItem[], dealStatusMap?: Map<string, string>): DealStats {
  const byGroup: Record<DealGroupKey, CrmItem[]> = {
    early: [],
    inWork: [],
    refusal: [],
    lostCompetition: [],
    won: [],
  };
  for (const deal of deals) {
    const stageId = pick(deal, "STAGE_ID", "stageId");
    let group = groupForDeal(stageId);
    if (!group) {
      const title = dealStatusMap?.get(String(stageId ?? ""));
      group = fallbackDealGroup(title);
    }
    byGroup[group].push(deal);
  }
  return {
    total: deals.length,
    early: byGroup.early.length,
    inWork: byGroup.inWork.length,
    refusal: byGroup.refusal.length,
    lostCompetition: byGroup.lostCompetition.length,
    won: byGroup.won.length,
    byGroup,
  };
}

export async function fetchLeadStatuses(): Promise<StatusRef[]> {
  try {
    const data = await callBx<Array<Record<string, unknown>>>("crm.status.list", {
      filter: { ENTITY_ID: "STATUS" },
      order: { SORT: "ASC" },
    });
    return (Array.isArray(data) ? data : []).map((row) => ({
      id: String(row.STATUS_ID ?? ""),
      title: String(row.NAME ?? row.STATUS_ID ?? ""),
      entityId: String(row.ENTITY_ID ?? ""),
    }));
  } catch {
    return [];
  }
}

export async function fetchDealStages(): Promise<StatusRef[]> {
  try {
    const rows: StatusRef[] = [];
    const primary = await callBx<Array<Record<string, unknown>>>("crm.dealcategory.stage.list", {
      id: 0,
    }).catch(() => [] as Array<Record<string, unknown>>);
    (Array.isArray(primary) ? primary : []).forEach((row) => {
      rows.push({
        id: String(row.STATUS_ID ?? ""),
        title: String(row.NAME ?? row.STATUS_ID ?? ""),
      });
    });
    return rows;
  } catch {
    return [];
  }
}

export function statusTitleMap(list: StatusRef[]): Map<string, string> {
  const map = new Map<string, string>();
  list.forEach((row) => map.set(row.id, row.title));
  return map;
}

export function leadGroupLabel(key: LeadGroupKey) {
  return LEAD_GROUP_LABELS[key];
}

export function dealGroupLabel(key: DealGroupKey) {
  return DEAL_GROUP_LABELS[key];
}

export async function buildExpoAggregate(expoId: string | number): Promise<ExpoAggregate | undefined> {
  const expo = await fetchExpo(expoId);
  if (!expo) return undefined;
  const [leads, deals, leadStatuses, dealStages] = await Promise.all([
    fetchLeadsByExpo(expoId),
    fetchDealsByExpo(expoId),
    fetchLeadStatuses(),
    fetchDealStages(),
  ]);
  return {
    expo,
    leads,
    deals,
    leadStats: computeLeadStats(leads, statusTitleMap(leadStatuses)),
    dealStats: computeDealStats(deals, statusTitleMap(dealStages)),
  };
}
