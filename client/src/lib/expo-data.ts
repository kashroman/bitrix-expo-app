import { callBx, CrmItem, listAllBx } from "./bitrix";
import {
  DEAL_GROUP_LABELS,
  DEAL_STATUS_ORDER,
  DealGroupKey,
  DealStatusKey,
  EXPO_DATE_FIELDS,
  EXPO_ENTITY_TYPE_ID,
  EXPO_LINK_FIELD,
  LEAD_GROUP_LABELS,
  LeadGroupKey,
  dealStageIds,
  fallbackDealGroup,
  fallbackLeadGroup,
  groupForDeal,
  groupForLead,
} from "./config";
import { fetchLinkedEntities, LinkFieldChoice } from "./expo-link";

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

export type ExpoAggregateDiagnostics = {
  lead: LinkFieldChoice;
  deal: LinkFieldChoice;
  errors: string[];
};

export type ExpoAggregateFound = {
  status: "found";
  expo: ExpoItem;
  leadStats: LeadStats;
  dealStats: DealStats;
  leads: CrmItem[];
  deals: CrmItem[];
  diagnostics: ExpoAggregateDiagnostics;
};

export type ExpoAggregateNotFound = {
  status: "not-found";
  expoId: string;
  diagnostics: ExpoAggregateDiagnostics;
};

export type ExpoAggregate = ExpoAggregateFound | ExpoAggregateNotFound;

export function isFoundAggregate(agg: ExpoAggregate | null | undefined): agg is ExpoAggregateFound {
  return !!agg && agg.status === "found";
}

function emptyLinkChoice(entity: "lead" | "deal"): LinkFieldChoice {
  return {
    entity,
    candidates: [],
    attempted: [],
    hasCustom: false,
    usedFallback: false,
    manualOverrideActive: false,
    manualFormatOverrideActive: false,
    warnings: [],
    totalCandidateCount: 0,
  };
}

export type StatusRef = {
  id: string;
  title: string;
  entityId?: string;
  categoryId?: string;
  sort?: number;
  source?: string;
};

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

export type FetchExpoOutcome =
  | { status: "found"; expo: ExpoItem }
  | { status: "not-found" }
  | { status: "failed"; error: string };

export async function fetchExpoOutcome(id: string | number): Promise<FetchExpoOutcome> {
  try {
    const data = await callBx<{ item: CrmItem }>("crm.item.get", {
      entityTypeId: EXPO_ENTITY_TYPE_ID,
      id,
      useOriginalUfNames: "N",
    });
    if (!data?.item) return { status: "not-found" };
    return { status: "found", expo: normalizeExpo(data.item) };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchExpo(id: string | number): Promise<ExpoItem | undefined> {
  const outcome = await fetchExpoOutcome(id);
  return outcome.status === "found" ? outcome.expo : undefined;
}

export async function fetchLeadsByExpo(expoId: string | number): Promise<CrmItem[]> {
  const outcome = await fetchLinkedEntities("lead", expoId);
  return outcome.rows as CrmItem[];
}

export async function fetchDealsByExpo(expoId: string | number): Promise<CrmItem[]> {
  const outcome = await fetchLinkedEntities("deal", expoId);
  return outcome.rows as CrmItem[];
}

async function mergeWithCrmItem(
  entityTypeId: number,
  id: string | number,
  base: CrmItem | undefined,
): Promise<CrmItem | undefined> {
  try {
    const data = await callBx<{ item: CrmItem }>("crm.item.get", {
      entityTypeId,
      id,
      useOriginalUfNames: "N",
    });
    if (data?.item) return { ...(base ?? {}), ...data.item };
  } catch {}
  return base;
}
void EXPO_LINK_FIELD;

export async function fetchLeadById(id: string | number): Promise<CrmItem | undefined> {
  let base: CrmItem | undefined;
  try {
    base = await callBx<CrmItem>("crm.lead.get", { id });
  } catch {
    base = undefined;
  }
  return mergeWithCrmItem(1, id, base);
}

export async function fetchDealById(id: string | number): Promise<CrmItem | undefined> {
  let base: CrmItem | undefined;
  try {
    base = await callBx<CrmItem>("crm.deal.get", { id });
  } catch {
    base = undefined;
  }
  return mergeWithCrmItem(2, id, base);
}

export type DealProbeLookup =
  | { status: "found"; deal: CrmItem }
  | { status: "not-found" }
  | { status: "failed"; error: string };

export async function probeDealById(id: string | number): Promise<DealProbeLookup> {
  try {
    const deal = await callBx<CrmItem>("crm.deal.get", { id });
    if (!deal || (typeof deal === "object" && Object.keys(deal).length === 0)) {
      return { status: "not-found" };
    }
    return { status: "found", deal };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
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

function entityIdToCategoryId(entityId: string | undefined): string | undefined {
  if (!entityId) return undefined;
  if (entityId === "DEAL_STAGE") return "0";
  const match = entityId.match(/^DEAL_STAGE_(\d+)$/);
  return match ? match[1] : undefined;
}

export type DealStagesAttempt = {
  source: string;
  entityId?: string;
  categoryId?: string;
  ok: boolean;
  count: number;
  error?: string;
};

export type DealStagesDiagnostics = {
  attempts: DealStagesAttempt[];
  categoryIds: string[];
  bySource: Record<string, number>;
  byEntityId: Record<string, number>;
  errors: string[];
};

export type DealStagesResult = {
  stages: StatusRef[];
  diagnostics: DealStagesDiagnostics;
};

const MAX_FALLBACK_CATEGORY_ID = 50;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function fetchDealStagesDetailed(): Promise<DealStagesResult> {
  const stages: StatusRef[] = [];
  const diagnostics: DealStagesDiagnostics = {
    attempts: [],
    categoryIds: [],
    bySource: {},
    byEntityId: {},
    errors: [],
  };

  const add = (row: StatusRef): boolean => {
    if (!row.id) return false;
    const existing = stages.find(
      (r) => r.id === row.id && (r.entityId ?? "") === (row.entityId ?? ""),
    );
    if (existing) {
      if (row.categoryId && !existing.categoryId) existing.categoryId = row.categoryId;
      if (row.entityId && !existing.entityId) existing.entityId = row.entityId;
      if (row.sort !== undefined && existing.sort === undefined) existing.sort = row.sort;
      if (row.source && !existing.source) existing.source = row.source;
      return false;
    }
    stages.push(row);
    return true;
  };

  const recordAttempt = (attempt: DealStagesAttempt) => {
    diagnostics.attempts.push(attempt);
    if (attempt.ok && attempt.count > 0) {
      diagnostics.bySource[attempt.source] =
        (diagnostics.bySource[attempt.source] ?? 0) + attempt.count;
      if (attempt.entityId) {
        diagnostics.byEntityId[attempt.entityId] =
          (diagnostics.byEntityId[attempt.entityId] ?? 0) + attempt.count;
      }
    }
    if (!attempt.ok && attempt.error) {
      const key = attempt.entityId ?? attempt.categoryId ?? attempt.source;
      diagnostics.errors.push(`${attempt.source}[${key}]: ${attempt.error}`);
    }
  };

  // 1) crm.dealcategory.list — discover pipeline category IDs.
  const categoryIds = new Set<string>(["0"]);
  try {
    const categories = await callBx<Array<Record<string, unknown>>>(
      "crm.dealcategory.list",
      { order: { SORT: "ASC" } },
    );
    const list = Array.isArray(categories) ? categories : [];
    list.forEach((cat) => {
      const id = String(cat.ID ?? cat.id ?? "");
      if (id) categoryIds.add(id);
    });
    recordAttempt({
      source: "dealcategory.list",
      ok: true,
      count: list.length,
    });
  } catch (err) {
    recordAttempt({
      source: "dealcategory.list",
      ok: false,
      count: 0,
      error: errorMessage(err),
    });
  }
  diagnostics.categoryIds = Array.from(categoryIds).sort((a, b) => Number(a) - Number(b));

  // 2) crm.dealcategory.stage.list for every known category.
  for (const categoryId of diagnostics.categoryIds) {
    const entityId = categoryId === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${categoryId}`;
    try {
      const stagesRes = await callBx<Array<Record<string, unknown>>>(
        "crm.dealcategory.stage.list",
        { id: categoryId },
      );
      const list = Array.isArray(stagesRes) ? stagesRes : [];
      let added = 0;
      list.forEach((row) => {
        const id = String(row.STATUS_ID ?? "");
        const sortRaw = row.SORT ?? row.sort;
        if (
          add({
            id,
            title: String(row.NAME ?? row.STATUS_ID ?? ""),
            entityId,
            categoryId,
            sort:
              sortRaw !== undefined && sortRaw !== null && sortRaw !== ""
                ? Number(sortRaw)
                : undefined,
            source: "dealcategory.stage.list",
          })
        ) {
          added += 1;
        }
      });
      recordAttempt({
        source: "dealcategory.stage.list",
        entityId,
        categoryId,
        ok: true,
        count: added,
      });
    } catch (err) {
      recordAttempt({
        source: "dealcategory.stage.list",
        entityId,
        categoryId,
        ok: false,
        count: 0,
        error: errorMessage(err),
      });
    }
  }

  // 3) crm.status.entity.types — pull real entity list if the server supports it.
  const entityIds = new Set<string>();
  entityIds.add("DEAL_STAGE");
  try {
    const entities = await callBx<Array<Record<string, unknown>>>(
      "crm.status.entity.types",
      {},
    );
    const list = Array.isArray(entities) ? entities : [];
    list.forEach((row) => {
      const id = String(row.ID ?? row.id ?? "");
      if (id.startsWith("DEAL_STAGE")) entityIds.add(id);
    });
    recordAttempt({
      source: "status.entity.types",
      ok: true,
      count: list.length,
    });
  } catch (err) {
    recordAttempt({
      source: "status.entity.types",
      ok: false,
      count: 0,
      error: errorMessage(err),
    });
  }

  // 4) Add DEAL_STAGE_<categoryId> for every discovered category, plus a bounded
  // range of DEAL_STAGE_0..DEAL_STAGE_50 as a defensive fallback in case neither
  // dealcategory.list nor status.entity.types returned anything useful.
  diagnostics.categoryIds.forEach((categoryId) => {
    if (categoryId === "0") return;
    entityIds.add(`DEAL_STAGE_${categoryId}`);
  });
  for (let i = 0; i <= MAX_FALLBACK_CATEGORY_ID; i += 1) {
    entityIds.add(`DEAL_STAGE_${i}`);
  }

  // 5) crm.status.list per entityId. Catches any pipeline not surfaced above.
  for (const entityId of Array.from(entityIds).sort()) {
    try {
      const stagesRes = await callBx<Array<Record<string, unknown>>>(
        "crm.status.list",
        {
          filter: { ENTITY_ID: entityId },
          order: { SORT: "ASC" },
        },
      );
      const list = Array.isArray(stagesRes) ? stagesRes : [];
      let added = 0;
      list.forEach((row) => {
        const id = String(row.STATUS_ID ?? "");
        const sortRaw = row.SORT ?? row.sort;
        if (
          add({
            id,
            title: String(row.NAME ?? id),
            entityId,
            categoryId: entityIdToCategoryId(entityId),
            sort:
              sortRaw !== undefined && sortRaw !== null && sortRaw !== ""
                ? Number(sortRaw)
                : undefined,
            source: "status.list",
          })
        ) {
          added += 1;
        }
      });
      recordAttempt({
        source: "status.list",
        entityId,
        categoryId: entityIdToCategoryId(entityId),
        ok: true,
        count: added,
      });
    } catch (err) {
      recordAttempt({
        source: "status.list",
        entityId,
        categoryId: entityIdToCategoryId(entityId),
        ok: false,
        count: 0,
        error: errorMessage(err),
      });
    }
  }

  return { stages, diagnostics };
}

const DEAL_STAGE_DIAGNOSTIC_SELECT = [
  "ID",
  "TITLE",
  "STAGE_ID",
  "STAGE_SEMANTIC_ID",
  "CATEGORY_ID",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "ASSIGNED_BY_ID",
  "COMPANY_TITLE",
  "CONTACT_NAME",
  "DATE_CREATE",
  "DATE_MODIFY",
  "UF_CRM_6989BC521C964",
];

export type DealStageProbeOptions = {
  categoryId?: string | number;
  limit?: number; // max rows to collect (default 300, hard cap 500)
};

export type DealStageProbeResult = {
  deals: CrmItem[];
  pages: number;
  truncated: boolean;
  requestedLimit: number;
  categoryId?: string | number;
  error?: string;
};

export async function fetchDealsForStageProbe(
  options: DealStageProbeOptions = {},
): Promise<DealStageProbeResult> {
  const requestedLimit = Math.max(
    1,
    Math.min(500, Math.floor(options.limit ?? 300)),
  );
  const filter: Record<string, unknown> = {};
  if (options.categoryId !== undefined && options.categoryId !== "") {
    filter.CATEGORY_ID = options.categoryId;
  }

  const deals: CrmItem[] = [];
  let pages = 0;
  let truncated = false;
  try {
    const rows = await listAllBx<CrmItem>(
      "crm.deal.list",
      {
        order: { ID: "DESC" },
        filter,
        select: DEAL_STAGE_DIAGNOSTIC_SELECT,
      },
      { maxPages: Math.max(1, Math.ceil(requestedLimit / 50)) + 1 },
    );
    for (const row of rows) {
      if (deals.length >= requestedLimit) {
        truncated = true;
        break;
      }
      deals.push(row);
      pages = Math.floor(deals.length / 50) + 1;
    }
    if (!truncated && rows.length > requestedLimit) truncated = true;
  } catch (err) {
    return {
      deals,
      pages,
      truncated,
      requestedLimit,
      categoryId: options.categoryId,
      error: errorMessage(err),
    };
  }
  return {
    deals,
    pages,
    truncated,
    requestedLimit,
    categoryId: options.categoryId,
  };
}

export type MonthlyDealBatchOutcome = {
  expoId: number;
  status: "ok" | "failed" | "timeout";
  deals: CrmItem[];
  error?: string;
  durationMs: number;
};

export type MonthlyDealBatchResult = {
  requestedExpoIds: number[];
  queriedExpoIds: number[];
  linkField: string;
  linkFormat: "numeric" | "string";
  outcomes: MonthlyDealBatchOutcome[];
  deals: CrmItem[];
  byExpoId: Map<number, CrmItem[]>;
  durationMs: number;
  timedOut: boolean;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
};

// Per-request Bitrix24 timeout for a single expo's deal list.
// Kept well below the SDK's own 45s ceiling so a stuck expo releases the
// concurrency slot quickly and the rest of the month can still render.
const MONTHLY_DEAL_REQUEST_TIMEOUT_MS = 12_000;
// Cap on pages for a single expo. UF_CRM_6989BC521C964 returns deals
// linked to that specific expo, so a handful of pages at most is expected.
const MONTHLY_DEAL_MAX_PAGES_PER_EXPO = 10;
// How many per-expo deal.list requests to run in parallel. Low enough to
// avoid overloading the BX24 SDK channel, high enough to keep the total
// time reasonable.
const MONTHLY_DEAL_CONCURRENCY = 3;

function extractExpoIdsFromDeal(
  deal: CrmItem,
  linkField: string,
): number[] {
  const r = deal as Record<string, unknown>;
  const raw =
    r[linkField] ??
    r[linkField.toUpperCase()] ??
    r[linkField.toLowerCase()] ??
    r[linkField.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase())];
  const values = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const out: number[] = [];
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(typeof v === "string" ? v.match(/\d+/)?.[0] ?? v : v);
    if (Number.isFinite(num) && num > 0) out.push(num);
  }
  return out;
}

async function fetchDealsForSingleExpo(
  linkField: string,
  expoId: number,
): Promise<MonthlyDealBatchOutcome> {
  const start = Date.now();
  try {
    const rows = await Promise.race<CrmItem[]>([
      listAllBx<CrmItem>(
        "crm.deal.list",
        {
          order: { ID: "DESC" },
          filter: { [linkField]: expoId },
          select: DEAL_STAGE_DIAGNOSTIC_SELECT,
        },
        {
          maxPages: MONTHLY_DEAL_MAX_PAGES_PER_EXPO,
          timeoutMs: MONTHLY_DEAL_REQUEST_TIMEOUT_MS,
        },
      ),
      new Promise<CrmItem[]>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `crm.deal.list timeout (${Math.round(
                  MONTHLY_DEAL_REQUEST_TIMEOUT_MS / 1000,
                )}s) for expo ${expoId}`,
              ),
            ),
          MONTHLY_DEAL_REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
    return {
      expoId,
      status: "ok",
      deals: rows,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = errorMessage(err);
    const isTimeout = /timeout|таймаут/i.test(message);
    return {
      expoId,
      status: isTimeout ? "timeout" : "failed",
      deals: [],
      error: message,
      durationMs: Date.now() - start,
    };
  }
}

export async function fetchMonthlyDealsForExpos(
  expoIds: Array<number | string>,
  options: { linkField?: string; concurrency?: number } = {},
): Promise<MonthlyDealBatchResult> {
  const linkField = options.linkField ?? "UF_CRM_6989BC521C964";
  const concurrency = Math.max(1, Math.min(options.concurrency ?? MONTHLY_DEAL_CONCURRENCY, 5));
  const uniqueIds = Array.from(
    new Set(
      expoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
  const start = Date.now();
  const byExpoId = new Map<number, CrmItem[]>();
  uniqueIds.forEach((id) => byExpoId.set(id, []));
  if (uniqueIds.length === 0) {
    return {
      requestedExpoIds: uniqueIds,
      queriedExpoIds: uniqueIds,
      linkField,
      linkFormat: "numeric",
      outcomes: [],
      deals: [],
      byExpoId,
      durationMs: 0,
      timedOut: false,
      successCount: 0,
      failedCount: 0,
      timeoutCount: 0,
    };
  }

  const outcomes: MonthlyDealBatchOutcome[] = new Array(uniqueIds.length);
  const allDeals: CrmItem[] = [];
  const seenDealIds = new Set<string>();

  let nextIndex = 0;
  const workers: Promise<void>[] = [];
  const run = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= uniqueIds.length) return;
      const expoId = uniqueIds[idx];
      const outcome = await fetchDealsForSingleExpo(linkField, expoId);
      outcomes[idx] = outcome;
      // Fold deals as soon as each outcome settles so partial results are
      // preserved even if later requests fail or time out.
      if (outcome.status === "ok") {
        for (const deal of outcome.deals) {
          const id = String((deal as Record<string, unknown>).ID ?? "");
          if (!id || seenDealIds.has(id)) continue;
          seenDealIds.add(id);
          allDeals.push(deal);
          const linkedExpoIds = extractExpoIdsFromDeal(deal, linkField);
          if (linkedExpoIds.length === 0) {
            const bucket = byExpoId.get(expoId);
            if (bucket) bucket.push(deal);
          } else {
            for (const linkedId of linkedExpoIds) {
              const bucket = byExpoId.get(linkedId);
              if (bucket) bucket.push(deal);
            }
          }
        }
      }
    }
  };
  for (let w = 0; w < Math.min(concurrency, uniqueIds.length); w++) {
    workers.push(run());
  }
  await Promise.all(workers);

  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const o of outcomes) {
    if (!o) continue;
    if (o.status === "ok") successCount += 1;
    else if (o.status === "timeout") timeoutCount += 1;
    else failedCount += 1;
  }

  return {
    requestedExpoIds: uniqueIds,
    queriedExpoIds: uniqueIds,
    linkField,
    linkFormat: "numeric",
    outcomes,
    deals: allDeals,
    byExpoId,
    durationMs: Date.now() - start,
    timedOut: timeoutCount > 0,
    successCount,
    failedCount,
    timeoutCount,
  };
}

// --- Stage-scan strategy for monthly Gantt deal bars -----------------------
//
// Problem: per-expo UF filter calls (fetchMonthlyDealsForExpos) consistently
// timeout in the live Bitrix24 environment for UF_CRM_6989BC521C964 — June
// 2026 diagnostics showed 24 expos queried, success=3, timeouts=21, deals=4.
//
// Strategy: the Gantt only needs bars for pinned stages signingContract (8),
// building (9), projectCompleted (WON). Rather than issuing N per-expo
// UF-filter calls, issue a small, bounded number of calls filtered by
// STAGE_ID only, then group by expo client-side using the UF field.
//
// Bitrix24's REST crm.deal.list STAGE_ID filter accepts a scalar value; it
// also accepts arrays for many fields but STAGE_ID is not guaranteed to
// support array-in syntax consistently across accounts. To stay safe we
// issue one call per pinned STAGE_ID with low concurrency (serial by
// default), merge and deduplicate by deal ID, then bucket by UF value.

const STAGE_SCAN_SELECT = DEAL_STAGE_DIAGNOSTIC_SELECT;
// Per-request timeout for a single STAGE_ID scan. Each stage is expected to
// have many more deals than one expo's UF bucket, so we allow more pages.
const STAGE_SCAN_REQUEST_TIMEOUT_MS = 20_000;
const STAGE_SCAN_MAX_PAGES_PER_STAGE = 10; // 10 * 50 = 500 deals per stage
const STAGE_SCAN_DEFAULT_CONCURRENCY = 1;

export type StageScanOutcome = {
  status: DealStatusKey;
  stageId: string;
  phase: "ok" | "failed" | "timeout";
  deals: CrmItem[];
  pages: number;
  error?: string;
  durationMs: number;
};

export type StageScanResult = {
  strategy: "stage-scan";
  linkField: string;
  requestedStageIds: Array<{ status: DealStatusKey; stageId: string | null }>;
  outcomes: StageScanOutcome[];
  deals: CrmItem[];
  byExpoId: Map<number, CrmItem[]>;
  // Deals that arrived but whose UF link value is missing or does not resolve
  // to a visible expo. Exposed for diagnostics only — they will not render.
  unlinkedDeals: CrmItem[];
  visibleExpoIds: number[];
  linkedToVisibleCount: number;
  perStageLinkedCount: Record<DealStatusKey, number>;
  durationMs: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  timedOut: boolean;
};

async function fetchDealsForSingleStage(
  status: DealStatusKey,
  stageId: string,
): Promise<StageScanOutcome> {
  const start = Date.now();
  try {
    const rows = await Promise.race<CrmItem[]>([
      listAllBx<CrmItem>(
        "crm.deal.list",
        {
          order: { ID: "DESC" },
          filter: { STAGE_ID: stageId },
          select: STAGE_SCAN_SELECT,
        },
        {
          maxPages: STAGE_SCAN_MAX_PAGES_PER_STAGE,
          timeoutMs: STAGE_SCAN_REQUEST_TIMEOUT_MS,
        },
      ),
      new Promise<CrmItem[]>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `crm.deal.list timeout (${Math.round(
                  STAGE_SCAN_REQUEST_TIMEOUT_MS / 1000,
                )}s) for STAGE_ID ${stageId}`,
              ),
            ),
          STAGE_SCAN_REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
    return {
      status,
      stageId,
      phase: "ok",
      deals: rows,
      pages: Math.max(1, Math.ceil(rows.length / 50)),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = errorMessage(err);
    const isTimeout = /timeout|таймаут/i.test(message);
    return {
      status,
      stageId,
      phase: isTimeout ? "timeout" : "failed",
      deals: [],
      pages: 0,
      error: message,
      durationMs: Date.now() - start,
    };
  }
}

export async function fetchMonthlyDealsByStageScan(
  visibleExpoIds: Array<number | string>,
  options: { linkField?: string; concurrency?: number } = {},
): Promise<StageScanResult> {
  const linkField = options.linkField ?? "UF_CRM_6989BC521C964";
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? STAGE_SCAN_DEFAULT_CONCURRENCY, 3),
  );
  const visible = Array.from(
    new Set(
      visibleExpoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
  const visibleSet = new Set(visible);

  const requested: Array<{ status: DealStatusKey; stageId: string | null }> =
    DEAL_STATUS_ORDER.map((status) => ({
      status,
      stageId: dealStageIds[status],
    }));
  const tasks = requested.filter(
    (t): t is { status: DealStatusKey; stageId: string } =>
      typeof t.stageId === "string" && t.stageId.length > 0,
  );

  const byExpoId = new Map<number, CrmItem[]>();
  visible.forEach((id) => byExpoId.set(id, []));
  const allDeals: CrmItem[] = [];
  const unlinked: CrmItem[] = [];
  const seenDealIds = new Set<string>();
  const perStageLinkedCount: Record<DealStatusKey, number> = {
    signingContract: 0,
    building: 0,
    projectCompleted: 0,
  };

  const start = Date.now();

  if (tasks.length === 0) {
    return {
      strategy: "stage-scan",
      linkField,
      requestedStageIds: requested,
      outcomes: [],
      deals: [],
      byExpoId,
      unlinkedDeals: [],
      visibleExpoIds: visible,
      linkedToVisibleCount: 0,
      perStageLinkedCount,
      durationMs: 0,
      successCount: 0,
      failedCount: 0,
      timeoutCount: 0,
      timedOut: false,
    };
  }

  const outcomes: StageScanOutcome[] = new Array(tasks.length);

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tasks.length) return;
      const task = tasks[idx];
      const outcome = await fetchDealsForSingleStage(task.status, task.stageId);
      outcomes[idx] = outcome;
      if (outcome.phase === "ok") {
        for (const deal of outcome.deals) {
          const rec = deal as Record<string, unknown>;
          const dealId = String(rec.ID ?? rec.id ?? "");
          if (!dealId || seenDealIds.has(dealId)) continue;
          seenDealIds.add(dealId);
          allDeals.push(deal);
          const linkedExpoIds = extractExpoIdsFromDeal(deal, linkField);
          let matched = false;
          for (const linkedId of linkedExpoIds) {
            if (!visibleSet.has(linkedId)) continue;
            const bucket = byExpoId.get(linkedId);
            if (bucket) {
              bucket.push(deal);
              matched = true;
            }
          }
          if (matched) perStageLinkedCount[task.status] += 1;
          else unlinked.push(deal);
        }
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const o of outcomes) {
    if (!o) continue;
    if (o.phase === "ok") successCount += 1;
    else if (o.phase === "timeout") timeoutCount += 1;
    else failedCount += 1;
  }

  let linkedToVisibleCount = 0;
  byExpoId.forEach((list) => {
    linkedToVisibleCount += list.length;
  });

  return {
    strategy: "stage-scan",
    linkField,
    requestedStageIds: requested,
    outcomes,
    deals: allDeals,
    byExpoId,
    unlinkedDeals: unlinked,
    visibleExpoIds: visible,
    linkedToVisibleCount,
    perStageLinkedCount,
    durationMs: Date.now() - start,
    successCount,
    failedCount,
    timeoutCount,
    timedOut: timeoutCount > 0,
  };
}

// --- Recent-deal-scan strategy (primary for Gantt) -------------------------
//
// Both the per-expo UF filter (fetchMonthlyDealsForExpos) and the per-pinned
// STAGE_ID scan (fetchMonthlyDealsByStageScan) time out consistently in the
// live Bitrix24 environment (12–20 s per request). The diagnostics panel's
// StageIdFinderPanel, however, reliably loads ~300 real deals quickly with
// the simplest possible shape: no filters except optional CATEGORY_ID, same
// select, order by ID DESC.
//
// Strategy: reuse that known-working shape. Scan a bounded number of recent
// deals (RECENT_DEAL_SCAN_DEFAULT_LIMIT), then client-side bucket them by
// pinned STAGE_ID (8, 9, WON) AND by the UF link field UF_CRM_6989BC521C964
// → visible expo IDs. Older deals are never visible in the current month's
// Gantt anyway, so scanning by ID DESC is a reasonable proxy for "recent
// enough to matter".
//
// This is a bounded scan — it will not page past the configured limit. If
// the Bitrix account exceeds that many deals newer than the pinned-stage
// matches, some bars may be missing. Bump the limit in code to widen the
// scan.

// Configurable page cap. Default 300 (6 pages of 50) — the known-working
// bounded scan size proved out by StageIdFinderPanel, which loaded 300
// deals in a few seconds and surfaced the target examples #2810
// (STAGE_ID 8), #3028 (STAGE_ID 9), and #3096 (WON). Hard cap 2000
// (40 pages) to keep the request bounded; raise the default in code if a
// wider scan is needed.
const RECENT_DEAL_SCAN_DEFAULT_LIMIT = 300;
const RECENT_DEAL_SCAN_HARD_CAP = 2000;

export type RecentScanOutcome = {
  status: DealStatusKey;
  stageId: string;
  phase: "ok" | "failed" | "timeout";
  deals: CrmItem[];
  pages: number;
  error?: string;
  durationMs: number;
};

export type RecentScanResult = {
  strategy: "recent-deal-scan";
  linkField: string;
  requestedStageIds: Array<{ status: DealStatusKey; stageId: string | null }>;
  outcomes: RecentScanOutcome[];
  deals: CrmItem[];
  byExpoId: Map<number, CrmItem[]>;
  unlinkedDeals: CrmItem[];
  visibleExpoIds: number[];
  linkedToVisibleCount: number;
  perStageLinkedCount: Record<DealStatusKey, number>;
  durationMs: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  timedOut: boolean;
  // Extra diagnostics specific to this strategy:
  scannedDealCount: number;
  pagesLoaded: number;
  requestedLimit: number;
  truncated: boolean;
  warning: string;
  scanError?: string;
};

export async function fetchMonthlyDealsByRecentScan(
  visibleExpoIds: Array<number | string>,
  options: { linkField?: string; limit?: number } = {},
): Promise<RecentScanResult> {
  const linkField = options.linkField ?? "UF_CRM_6989BC521C964";
  const requestedLimit = Math.max(
    50,
    Math.min(
      RECENT_DEAL_SCAN_HARD_CAP,
      Math.floor(options.limit ?? RECENT_DEAL_SCAN_DEFAULT_LIMIT),
    ),
  );
  const visible = Array.from(
    new Set(
      visibleExpoIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
  const visibleSet = new Set(visible);

  const byExpoId = new Map<number, CrmItem[]>();
  visible.forEach((id) => byExpoId.set(id, []));

  const requested: Array<{ status: DealStatusKey; stageId: string | null }> =
    DEAL_STATUS_ORDER.map((status) => ({
      status,
      stageId: dealStageIds[status],
    }));
  const stageIdToStatus = new Map<string, DealStatusKey>();
  requested.forEach((r) => {
    if (r.stageId) stageIdToStatus.set(r.stageId, r.status);
  });

  const perStageLinkedCount: Record<DealStatusKey, number> = {
    signingContract: 0,
    building: 0,
    projectCompleted: 0,
  };
  const perStageOutcomeDeals: Record<DealStatusKey, CrmItem[]> = {
    signingContract: [],
    building: [],
    projectCompleted: [],
  };

  const start = Date.now();
  const warning = `Bounded recent-deal scan: reads up to ${requestedLimit} most-recent deals via crm.deal.list (no filter), then client-side filters to pinned stages (8/9/WON) linked to visible expos. Scans the ${requestedLimit} most recent deals — older deals are not included; limit can be raised later.`;

  let allScanned: CrmItem[] = [];
  let pagesLoaded = 0;
  let truncated = false;
  let scanError: string | undefined;
  try {
    const rows = await listAllBx<CrmItem>(
      "crm.deal.list",
      {
        order: { ID: "DESC" },
        filter: {},
        select: DEAL_STAGE_DIAGNOSTIC_SELECT,
      },
      {
        maxPages: Math.max(1, Math.ceil(requestedLimit / 50)) + 1,
      },
    );
    if (rows.length >= requestedLimit) {
      allScanned = rows.slice(0, requestedLimit);
      truncated = rows.length > requestedLimit;
    } else {
      allScanned = rows;
    }
    pagesLoaded = Math.max(1, Math.ceil(allScanned.length / 50));
  } catch (err) {
    scanError = errorMessage(err);
  }

  const linkedDeals: CrmItem[] = [];
  const unlinkedDeals: CrmItem[] = [];
  const seenDealIds = new Set<string>();
  for (const deal of allScanned) {
    const rec = deal as Record<string, unknown>;
    const dealId = String(rec.ID ?? rec.id ?? "");
    if (!dealId || seenDealIds.has(dealId)) continue;
    seenDealIds.add(dealId);

    const rawStageId = String(rec.STAGE_ID ?? rec.stageId ?? "");
    if (!rawStageId) continue;
    const pinnedStatus =
      stageIdToStatus.get(rawStageId) ??
      stageIdToStatus.get(rawStageId.split(":").pop() ?? rawStageId);
    if (!pinnedStatus) continue;

    linkedDeals.push(deal);
    perStageOutcomeDeals[pinnedStatus].push(deal);

    const linkedExpoIds = extractExpoIdsFromDeal(deal, linkField);
    let matched = false;
    for (const linkedId of linkedExpoIds) {
      if (!visibleSet.has(linkedId)) continue;
      const bucket = byExpoId.get(linkedId);
      if (bucket) {
        bucket.push(deal);
        matched = true;
      }
    }
    if (matched) perStageLinkedCount[pinnedStatus] += 1;
    else unlinkedDeals.push(deal);
  }

  // Synthesize per-stage outcomes from the single scan so the existing
  // diagnostics panel can render the same layout as stage-scan. The whole
  // scan either succeeded or failed, so the phase reflects that.
  const phase: "ok" | "failed" | "timeout" = scanError
    ? /timeout|таймаут/i.test(scanError)
      ? "timeout"
      : "failed"
    : "ok";
  const outcomes: RecentScanOutcome[] = requested
    .filter(
      (r): r is { status: DealStatusKey; stageId: string } =>
        typeof r.stageId === "string" && r.stageId.length > 0,
    )
    .map((r) => ({
      status: r.status,
      stageId: r.stageId,
      phase,
      deals: perStageOutcomeDeals[r.status],
      pages: phase === "ok" ? pagesLoaded : 0,
      error: scanError,
      durationMs: Date.now() - start,
    }));

  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const o of outcomes) {
    if (o.phase === "ok") successCount += 1;
    else if (o.phase === "timeout") timeoutCount += 1;
    else failedCount += 1;
  }

  let linkedToVisibleCount = 0;
  byExpoId.forEach((list) => {
    linkedToVisibleCount += list.length;
  });

  return {
    strategy: "recent-deal-scan",
    linkField,
    requestedStageIds: requested,
    outcomes,
    deals: linkedDeals,
    byExpoId,
    unlinkedDeals,
    visibleExpoIds: visible,
    linkedToVisibleCount,
    perStageLinkedCount,
    durationMs: Date.now() - start,
    successCount,
    failedCount,
    timeoutCount,
    timedOut: timeoutCount > 0,
    scannedDealCount: allScanned.length,
    pagesLoaded,
    requestedLimit,
    truncated,
    warning,
    scanError,
  };
}

export async function fetchDealStages(): Promise<StatusRef[]> {
  try {
    const { stages } = await fetchDealStagesDetailed();
    return stages;
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

export async function buildExpoAggregate(expoId: string | number): Promise<ExpoAggregate> {
  const idStr = String(expoId);
  const [expoRes, leadsRes, dealsRes, leadStatusesRes, dealStagesRes] = await Promise.allSettled([
    fetchExpoOutcome(expoId),
    fetchLinkedEntities("lead", expoId),
    fetchLinkedEntities("deal", expoId),
    fetchLeadStatuses(),
    fetchDealStages(),
  ]);
  const errs: string[] = [];

  const leadOutcome = leadsRes.status === "fulfilled" ? leadsRes.value : undefined;
  const dealOutcome = dealsRes.status === "fulfilled" ? dealsRes.value : undefined;
  if (leadsRes.status === "rejected") {
    errs.push(`leads: ${String((leadsRes.reason as Error)?.message ?? leadsRes.reason)}`);
  }
  if (dealsRes.status === "rejected") {
    errs.push(`deals: ${String((dealsRes.reason as Error)?.message ?? dealsRes.reason)}`);
  }
  if (leadStatusesRes.status === "rejected") {
    errs.push(`lead-statuses: ${String((leadStatusesRes.reason as Error)?.message ?? leadStatusesRes.reason)}`);
  }
  if (dealStagesRes.status === "rejected") {
    errs.push(`deal-stages: ${String((dealStagesRes.reason as Error)?.message ?? dealStagesRes.reason)}`);
  }

  const leadChoice: LinkFieldChoice = leadOutcome?.choice ?? emptyLinkChoice("lead");
  const dealChoice: LinkFieldChoice = dealOutcome?.choice ?? emptyLinkChoice("deal");

  let expoError: string | undefined;
  let expo: ExpoItem | undefined;
  if (expoRes.status === "fulfilled") {
    const out = expoRes.value;
    if (out.status === "found") {
      expo = out.expo;
    } else if (out.status === "failed") {
      expoError = out.error;
    }
  } else {
    expoError = String((expoRes.reason as Error)?.message ?? expoRes.reason);
  }
  if (expoError) errs.push(`expo: ${expoError}`);

  if (typeof console !== "undefined" && errs.length) console.warn("buildExpoAggregate partial failure", errs);

  if (!expo) {
    return {
      status: "not-found",
      expoId: idStr,
      diagnostics: { lead: leadChoice, deal: dealChoice, errors: errs },
    };
  }

  const leads = (leadOutcome?.rows ?? []) as CrmItem[];
  const deals = (dealOutcome?.rows ?? []) as CrmItem[];
  const leadStatuses = leadStatusesRes.status === "fulfilled" ? leadStatusesRes.value : [];
  const dealStages = dealStagesRes.status === "fulfilled" ? dealStagesRes.value : [];

  return {
    status: "found",
    expo,
    leads,
    deals,
    leadStats: computeLeadStats(leads, statusTitleMap(leadStatuses)),
    dealStats: computeDealStats(deals, statusTitleMap(dealStages)),
    diagnostics: {
      lead: leadChoice,
      deal: dealChoice,
      errors: errs,
    },
  };
}
